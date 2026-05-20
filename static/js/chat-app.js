/**
 * Bubblle unified chat shell: sidebar bubbles + room chat + identity.
 */
import { bootstrapSession, cachedDisplayName, updateDisplayName } from "./session.js";
import {
  acquireLocation,
  formatGeolocationError,
  isGeolocationContextOk,
  readCachedPosition,
  requestLocationOnce,
  secureContextHint,
} from "./geo.js";

const $ = (sel) => document.querySelector(sel);
const SEARCH_RADIUS_M = 5000;
const NEARBY_POLL_MS = 5000;
const WS_RECONNECT_BASE_MS = 3000;
const WS_RECONNECT_MAX_MS = 20000;
const MSG_COOLDOWN_MS = 1000;

const bubbleId = (window.__BUBBLE_ID__ || "").trim() || null;

let myName = "";
let pos = null;
let stopLocation = null;
let nearbyPollTimer = null;
let nearbyBubbles = [];

let activeSocket = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let allowReconnect = true;
let bubbleActive = true;
let typingTimer = null;
let lastTypingSent = 0;
let sendCooldownUntil = 0;
let sendCooldownTick = null;
const outboundQueue = [];
const messageById = new Map();
let pendingReply = null;

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function truncateText(s, max = 80) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function rememberMessage(m) {
  if (m?.id) messageById.set(String(m.id), m);
}

function replyQuoteHtml(reply) {
  if (!reply?.anonymous_name) return "";
  return `<div class="msg-reply-quote">
    <span class="msg-reply-author">${escapeHtml(reply.anonymous_name)}</span>
    <span class="msg-reply-text">${escapeHtml(truncateText(reply.message))}</span>
  </div>`;
}

function setReplyTarget(m) {
  if (!m?.id || !bubbleActive) return;
  pendingReply = {
    id: String(m.id),
    anonymous_name: m.anonymous_name,
    message: m.message,
  };
  const bar = $("#reply-compose");
  const label = $("#reply-compose-label");
  const preview = $("#reply-compose-preview");
  const input = $("#chat-input");
  if (label) label.textContent = `Reply to ${m.anonymous_name}`;
  if (preview) preview.textContent = truncateText(m.message, 100);
  bar?.removeAttribute("hidden");
  input?.focus();
}

function clearReply() {
  pendingReply = null;
  $("#reply-compose")?.setAttribute("hidden", "hidden");
}

function fmtRemaining(sec) {
  if (sec <= 0) return "Ended";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function activeUsers(b) {
  return b.active_users ?? b.online_count ?? 0;
}

/* --- Location (sidebar pill only — no sticky banner) --- */

function setLocPill(state, title = "") {
  const el = $("#loc-pill");
  if (!el) return;
  el.dataset.state = state;
  const titles = { idle: "Location", loading: "Locating…", ok: "Location on", error: "Location off" };
  el.title = title || titles[state] || "";
}

function setSidebarEmpty(text) {
  const el = $("#sidebar-empty");
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || "";
}

function applyPosition(p, { quiet = false } = {}) {
  pos = p;
  $("#f-lat").value = String(p.lat);
  $("#f-lng").value = String(p.lng);
  setLocPill("ok");
  if (!quiet) setSidebarEmpty("");
  refreshSidebar();
  startNearbyPolling();
  if (bubbleId) {
    onEnterBubble();
  }
}

function startLocation() {
  if (!isGeolocationContextOk()) {
    setLocPill("error", secureContextHint());
    setSidebarEmpty(secureContextHint());
    return;
  }

  const cached = readCachedPosition();
  if (cached) {
    applyPosition(cached, { quiet: true });
    if (stopLocation) stopLocation();
    stopLocation = acquireLocation({
      onUpdate: (p, meta) => applyPosition(p, { quiet: meta.source === "refined" }),
      onError: () => {},
    });
    return;
  }

  setLocPill("idle");
  setSidebarEmpty("Tap + Create to allow location, or ↻ to refresh nearby.");
}

async function ensureLocation({ hint = "Allow location to continue…" } = {}) {
  if (pos) return pos;
  if (!isGeolocationContextOk()) {
    const msg = secureContextHint();
    setLocPill("error", msg);
    setSidebarEmpty(msg);
    throw new Error(msg);
  }
  setLocPill("loading");
  setSidebarEmpty(hint);
  try {
    const p = await requestLocationOnce();
    applyPosition(p);
    if (stopLocation) stopLocation();
    stopLocation = acquireLocation({
      onUpdate: (point, meta) => applyPosition(point, { quiet: meta.source === "refined" }),
      onError: () => {},
    });
    return p;
  } catch (err) {
    setLocPill("error");
    setSidebarEmpty(formatGeolocationError(err));
    throw err;
  }
}

/* --- Sidebar --- */

function renderSidebar() {
  const ul = $("#sidebar-bubbles");
  if (!ul) return;
  ul.innerHTML = "";

  if (!nearbyBubbles.length) {
    setSidebarEmpty(pos ? "No bubbles within 5 km. Create one!" : "Waiting for location…");
    return;
  }
  setSidebarEmpty("");

  for (const b of nearbyBubbles) {
    const li = document.createElement("li");
    const isActive = bubbleId === b.id;
    li.className = `sidebar-bubble${isActive ? " is-active" : ""}`;
    li.innerHTML = `
      <a href="/bubble/${b.id}/" class="sidebar-bubble-link">
        <span class="sidebar-bubble-title">${escapeHtml(b.title)}</span>
        <span class="sidebar-bubble-meta">
          <span class="sidebar-bubble-count">${activeUsers(b)} active</span>
          <span class="sidebar-bubble-expiry">${fmtRemaining(b.remaining_seconds)}</span>
        </span>
      </a>`;
    ul.appendChild(li);
  }
}

async function refreshSidebar() {
  if (!pos) return;
  const params = new URLSearchParams({
    lat: String(pos.lat),
    lng: String(pos.lng),
    search_radius_m: String(SEARCH_RADIUS_M),
  });
  try {
    const res = await fetch(`/api/bubbles/nearby/?${params}`, { credentials: "include" });
    if (!res.ok) {
      setSidebarEmpty("Could not load bubbles.");
      return;
    }
    const data = await res.json();
    nearbyBubbles = data.results || [];
    renderSidebar();
  } catch {
    setSidebarEmpty("Network error loading bubbles.");
  }
}

function startNearbyPolling() {
  stopNearbyPolling();
  nearbyPollTimer = setInterval(() => {
    if (pos && document.visibilityState !== "hidden") refreshSidebar();
  }, NEARBY_POLL_MS);
}

function stopNearbyPolling() {
  if (nearbyPollTimer) {
    clearInterval(nearbyPollTimer);
    nearbyPollTimer = null;
  }
}

/* --- Identity --- */

async function saveName() {
  const input = $("#display-name");
  if (!input) return;
  const trimmed = input.value.trim();
  if (trimmed.length < 2) {
    input.classList.add("identity-input-error");
    return;
  }
  input.classList.remove("identity-input-error");
  try {
    const data = await updateDisplayName(trimmed);
    myName = data.anonymous_name;
    input.classList.add("identity-saved");
    setTimeout(() => input.classList.remove("identity-saved"), 600);
  } catch (err) {
    input.classList.add("identity-input-error");
  }
}

function setupIdentity() {
  const input = $("#display-name");
  if (!input) return;
  $("#btn-save-name")?.addEventListener("click", () => saveName());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveName();
    }
  });
  input.addEventListener("blur", () => {
    if (input.value.trim() !== myName) saveName();
  });
}

/* --- Chat room UI --- */

function showWelcome() {
  const panel = $("#chat-panel");
  const thread = $("#chat-thread");
  panel?.classList.add("chat-panel--idle");
  $("#chat-idle-prompt")?.removeAttribute("hidden");
  thread?.setAttribute("hidden", "hidden");
  $("#chat-composer")?.setAttribute("hidden", "hidden");
  clearReply();
  messageById.clear();
  const messages = $("#messages");
  if (messages) messages.innerHTML = "";
  $("#chat-input")?.setAttribute("disabled", "disabled");
  $("#btn-send")?.setAttribute("disabled", "disabled");
  $("#bubble-title").textContent = "Pick a bubble";
  $("#bubble-expiry").textContent = "";
  $("#online-count").textContent = "";
  setConnDot("idle");
}

function showThread() {
  const panel = $("#chat-panel");
  const thread = $("#chat-thread");
  panel?.classList.remove("chat-panel--idle");
  $("#chat-idle-prompt")?.setAttribute("hidden", "hidden");
  thread?.removeAttribute("hidden");
  $("#chat-composer")?.removeAttribute("hidden");
  $("#chat-input")?.removeAttribute("disabled");
  if (!isSendOnCooldown()) $("#btn-send")?.removeAttribute("disabled");
}

function setConnDot(state, title = "") {
  const el = $("#conn-dot");
  if (!el) return;
  el.dataset.state = state;
  el.title = title || state;
}

function setStatus(msg, show) {
  const s = $("#chat-status");
  if (!s) return;
  s.hidden = !show;
  s.textContent = msg || "";
}

function isSendOnCooldown() {
  return Date.now() < sendCooldownUntil;
}

function setSendEnabled(on) {
  const btn = $("#btn-send");
  if (btn) btn.disabled = !on;
}

function setComposerHint(msg, { kind = "muted" } = {}) {
  const el = $("#composer-hint");
  if (!el) return;
  if (!msg) {
    if (isSendOnCooldown() && el.dataset.kind === "cooldown") return;
    el.hidden = true;
    el.textContent = "";
    el.dataset.kind = "";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
  el.dataset.kind = kind;
  el.className = kind === "cooldown" ? "composer-hint composer-hint-warn" : "composer-hint muted";
}

function refreshCooldownUi() {
  if (!isSendOnCooldown()) {
    if (sendCooldownTick) clearInterval(sendCooldownTick);
    sendCooldownTick = null;
    setSendEnabled(true);
    setComposerHint("");
    return;
  }
  const sec = Math.max(1, Math.ceil((sendCooldownUntil - Date.now()) / 1000));
  setComposerHint(`Wait ${sec}s`, { kind: "cooldown" });
  setSendEnabled(false);
}

function startSendCooldown() {
  sendCooldownUntil = Date.now() + MSG_COOLDOWN_MS;
  refreshCooldownUi();
  if (sendCooldownTick) clearInterval(sendCooldownTick);
  sendCooldownTick = setInterval(refreshCooldownUi, 250);
}

function clearMessagesPlaceholder() {
  $("#messages-placeholder")?.remove();
}

function scrollMessages() {
  const scroller = $("#messages-scroll");
  if (!scroller) return;
  requestAnimationFrame(() => {
    scroller.scrollTop = scroller.scrollHeight;
  });
}

function appendMessage(m, opts = { scroll: true }) {
  clearMessagesPlaceholder();
  rememberMessage(m);
  const list = $("#messages");
  const mine = myName && m.anonymous_name === myName;
  const row = document.createElement("div");
  row.className = `msg-bubble${mine ? " msg-bubble-mine" : ""}`;
  row.dataset.messageId = String(m.id);
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  row.setAttribute("aria-label", `Reply to message from ${m.anonymous_name}`);
  const t = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  row.innerHTML = `
    <div class="msg-bubble-inner">
      ${replyQuoteHtml(m.reply_to)}
      ${mine ? "" : `<span class="msg-author">${escapeHtml(m.anonymous_name)}</span>`}
      <p class="msg-text">${escapeHtml(m.message)}</p>
      <span class="msg-time">${t}</span>
    </div>`;
  list.appendChild(row);
  row.style.animation = "msg-in 0.28s ease-out";
  if (opts.scroll) scrollMessages();
}

/* --- WebSocket --- */

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/bubble/${bubbleId}/?lat=${encodeURIComponent(pos.lat)}&lng=${encodeURIComponent(pos.lng)}`;
}

function isWsOpen() {
  return activeSocket?.readyState === WebSocket.OPEN;
}

function isWsBusy() {
  return (
    activeSocket &&
    (activeSocket.readyState === WebSocket.CONNECTING ||
      activeSocket.readyState === WebSocket.OPEN)
  );
}

function isPermanentWsClose(code) {
  return code === 4400 || code === 4401 || code === 4403 || code === 4404;
}

function permanentCloseMessage(code) {
  if (code === 4401) return "Session missing — refresh.";
  if (code === 4403) return "Outside bubble radius.";
  if (code === 4404) return "Bubble ended.";
  return "Cannot join.";
}

function stopReconnecting(msg) {
  allowReconnect = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  setConnDot("error", msg);
  setStatus(msg, true);
}

function detachSocket(socket) {
  socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
  try {
    socket.close();
  } catch {
    /* ignore */
  }
}

function chatPayload(text, replyTo = pendingReply) {
  const payload = {
    type: "chat",
    message: text,
    latitude: pos.lat,
    longitude: pos.lng,
  };
  if (replyTo?.id) payload.reply_to = replyTo.id;
  return payload;
}

function flushOutboundQueue() {
  if (!isWsOpen() || !pos || !outboundQueue.length || isSendOnCooldown()) return;
  const item = outboundQueue.shift();
  if (item?.kind === "chat") {
    activeSocket.send(JSON.stringify(chatPayload(item.text, item.replyTo)));
  }
}

function scheduleReconnect() {
  if (!allowReconnect || !pos || !bubbleActive || reconnectTimer) return;
  const delay = Math.min(WS_RECONNECT_BASE_MS * 2 ** reconnectAttempt, WS_RECONNECT_MAX_MS);
  reconnectAttempt += 1;
  setConnDot("loading", "Reconnecting");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs();
  }, delay);
}

function connectWs() {
  if (!bubbleId || !pos || !bubbleActive || !allowReconnect || isWsBusy()) return;
  setConnDot("loading", "Connecting");

  const socket = new WebSocket(wsUrl());
  activeSocket = socket;

  socket.onopen = () => {
    if (activeSocket !== socket) return;
    reconnectAttempt = 0;
    setConnDot("ok", "Live");
    setStatus("", false);
    flushOutboundQueue();
  };

  socket.onclose = (ev) => {
    if (activeSocket !== socket) return;
    activeSocket = null;
    if (isPermanentWsClose(ev.code)) {
      stopReconnecting(permanentCloseMessage(ev.code));
      return;
    }
    if (!allowReconnect || !bubbleActive) {
      setConnDot("error");
      return;
    }
    scheduleReconnect();
  };

  socket.onerror = () => {};

  socket.onmessage = (ev) => {
    if (activeSocket !== socket) return;
    let data;
    try {
      data = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (data.type === "chat") {
      appendMessage(data.payload);
      $("#typing").hidden = true;
    } else if (data.type === "presence") {
      const n = data.active_users ?? data.online;
      if (typeof n === "number") $("#online-count").textContent = `${n} active`;
    } else if (data.type === "typing") {
      const t = $("#typing");
      if (data.typing) {
        t.hidden = false;
        t.textContent = `${data.name} is typing…`;
      } else {
        t.hidden = true;
      }
    } else if (data.type === "error") {
      if (data.code === "slow_down") startSendCooldown();
      else if (data.code === "invalid_reply") setComposerHint("Could not reply to that message.", { kind: "cooldown" });
      else if (data.code === "out_of_radius") setStatus("You moved outside the bubble.", true);
      else if (data.code === "bubble_closed") {
        bubbleActive = false;
        allowReconnect = false;
        detachSocket(socket);
        setStatus("Bubble ended.", true);
        setConnDot("error");
      }
    }
  };
}

function sendChat(text) {
  if (!text || !pos) return;
  if (isSendOnCooldown()) {
    refreshCooldownUi();
    return;
  }
  if (isWsOpen()) {
    activeSocket.send(JSON.stringify(chatPayload(text)));
    activeSocket.send(
      JSON.stringify({ type: "typing", typing: false, latitude: pos.lat, longitude: pos.lng })
    );
    clearReply();
    return;
  }
  outboundQueue.push({ kind: "chat", text, replyTo: pendingReply ? { ...pendingReply } : null });
  clearReply();
  setComposerHint("Sending when live…", { kind: "info" });
  connectWs();
}

function loadBubbleMeta() {
  if (!bubbleId || !pos) return;
  const q = new URLSearchParams({ lat: String(pos.lat), lng: String(pos.lng) });
  fetch(`/api/bubbles/${bubbleId}/?${q}`, { credentials: "include" })
    .then((res) => (res.ok ? res.json() : null))
    .then((b) => {
      if (!b) {
        $("#bubble-title").textContent = "Not found";
        stopReconnecting("Bubble not found.");
        return;
      }
      $("#bubble-title").textContent = b.title;
      $("#bubble-expiry").textContent = fmtRemaining(b.remaining_seconds);
      const n = b.active_users ?? b.online_count;
      if (typeof n === "number") $("#online-count").textContent = `${n} active`;
      if (!b.active) {
        bubbleActive = false;
        allowReconnect = false;
        setStatus("This bubble has ended.", true);
        setConnDot("error");
      } else if (b.distance_m != null && b.distance_m > b.radius) {
        stopReconnecting("Move closer to join this bubble.");
      }
    })
    .catch(() => {});
}

function loadHistory() {
  if (!bubbleId) return;
  const ph = $("#messages-placeholder");
  if (ph) ph.textContent = "Loading messages…";

  fetch(`/api/bubbles/${bubbleId}/messages/?limit=80`, { credentials: "include" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      clearMessagesPlaceholder();
      const wrap = $("#messages");
      wrap.innerHTML = "";
      if (!data?.results?.length) {
        const p = document.createElement("p");
        p.className = "messages-placeholder muted";
        p.textContent = "No messages yet — say hello!";
        wrap.appendChild(p);
        return;
      }
      for (const m of data.results) appendMessage(m, { scroll: false });
      scrollMessages();
    })
    .catch(() => clearMessagesPlaceholder());
}

function teardownChat() {
  allowReconnect = false;
  clearReply();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (activeSocket) detachSocket(activeSocket);
  activeSocket = null;
  reconnectTimer = null;
}

function onEnterBubble() {
  if (!bubbleId) {
    showWelcome();
    teardownChat();
    return;
  }
  allowReconnect = true;
  bubbleActive = true;
  reconnectAttempt = 0;
  showThread();
  messageById.clear();
  clearReply();
  const messages = $("#messages");
  if (messages) {
    messages.innerHTML = "";
    const ph = document.createElement("p");
    ph.className = "messages-placeholder";
    ph.id = "messages-placeholder";
    ph.textContent = "Loading messages…";
    messages.appendChild(ph);
  }
  loadBubbleMeta();
  loadHistory();
  if (pos) connectWs();
}

/* --- Drawer (mobile) --- */

function setDrawerOpen(open) {
  const sidebar = $("#sidebar");
  const backdrop = $("#drawer-backdrop");
  const btn = $("#btn-drawer");
  if (!sidebar || !backdrop) return;

  if (open) {
    sidebar.classList.add("is-open");
    sidebar.setAttribute("aria-hidden", "false");
    backdrop.removeAttribute("hidden");
    backdrop.setAttribute("aria-hidden", "false");
    btn?.setAttribute("aria-expanded", "true");
    document.body.classList.add("drawer-open");
  } else {
    sidebar.classList.remove("is-open");
    if (window.matchMedia("(max-width: 900px)").matches) {
      sidebar.setAttribute("aria-hidden", "true");
    } else {
      sidebar.removeAttribute("aria-hidden");
    }
    backdrop.setAttribute("hidden", "hidden");
    backdrop.setAttribute("aria-hidden", "true");
    btn?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("drawer-open");
  }
}

function setupDrawer() {
  const btn = $("#btn-drawer");
  const backdrop = $("#drawer-backdrop");
  const sidebar = $("#sidebar");
  if (!btn || !backdrop || !sidebar) return;

  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "sidebar");

  const openDrawer = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDrawerOpen(true);
  };

  btn.addEventListener("click", openDrawer);
  backdrop.addEventListener("click", () => setDrawerOpen(false));
  $("#sidebar-bubbles")?.addEventListener("click", (e) => {
    if (e.target.closest("a")) setDrawerOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setDrawerOpen(false);
  });

  if (window.matchMedia("(max-width: 900px)").matches) {
    sidebar.setAttribute("aria-hidden", "true");
  }
}

/* --- Reply interactions --- */

function setupReplyComposer() {
  $("#reply-compose-cancel")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearReply();
  });
}

function setupMessageReplies() {
  const list = $("#messages");
  if (!list) return;

  const pickMessage = (row) => {
    if (!row?.dataset.messageId || !bubbleActive) return;
    const m = messageById.get(row.dataset.messageId);
    if (m) setReplyTarget(m);
  };

  list.addEventListener("click", (e) => {
    const row = e.target.closest(".msg-bubble");
    if (row) pickMessage(row);
  });

  list.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest(".msg-bubble");
    if (!row) return;
    e.preventDefault();
    pickMessage(row);
  });

  let touchRow = null;
  let touchStartX = 0;
  list.addEventListener(
    "touchstart",
    (e) => {
      touchRow = e.target.closest(".msg-bubble");
      touchStartX = touchRow ? e.touches[0].clientX : 0;
    },
    { passive: true }
  );
  list.addEventListener(
    "touchend",
    (e) => {
      if (!touchRow) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (dx > 48) pickMessage(touchRow);
      touchRow = null;
    },
    { passive: true }
  );
}

/* --- Init --- */

function setupComposer() {
  $("#chat-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#chat-input")?.value.trim();
    if (!text || !bubbleId) return;
    if (!pos) {
      setComposerHint("Waiting for location…");
      return;
    }
    if (!bubbleActive) return;
    if (isSendOnCooldown()) {
      refreshCooldownUi();
      return;
    }
    sendChat(text);
    $("#chat-input").value = "";
  });

  $("#chat-input")?.addEventListener("input", () => {
    if (!isWsOpen()) return;
    const now = Date.now();
    if (now - lastTypingSent > 2500) {
      activeSocket.send(
        JSON.stringify({ type: "typing", typing: true, latitude: pos.lat, longitude: pos.lng })
      );
      lastTypingSent = now;
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (isWsOpen()) {
        activeSocket.send(
          JSON.stringify({ type: "typing", typing: false, latitude: pos.lat, longitude: pos.lng })
        );
      }
    }, 1600);
  });
}

function setupCreate() {
  $("#create-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = e.target.title.value.trim();
    if (!title) return;

    const btn = $("#btn-create");
    btn.disabled = true;
    try {
      if (!pos) {
        await ensureLocation({ hint: "Allow location to create your bubble…" });
      }
      await saveName();
      const res = await fetch("/api/bubbles/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, latitude: pos.lat, longitude: pos.lng }),
      });
      if (!res.ok) {
        return;
      }
      const b = await res.json();
      window.location.href = `/bubble/${b.id}/`;
    } catch {
      /* location denied or network error — message already in sidebar */
    } finally {
      btn.disabled = false;
    }
  });
}

async function main() {
  setupIdentity();
  setupDrawer();
  setupReplyComposer();
  setupMessageReplies();
  setupComposer();
  setupCreate();
  $("#btn-refresh-bubbles")?.addEventListener("click", async () => {
    try {
      if (!pos) await ensureLocation({ hint: "Allow location to see nearby bubbles…" });
      refreshSidebar();
    } catch {
      /* hint shown in sidebar */
    }
  });

  if (bubbleId) {
    showThread();
  } else {
    showWelcome();
  }

  // Request location immediately — do not wait on session/network first.
  startLocation();

  try {
    const session = await bootstrapSession();
    myName = session.anonymous_name || cachedDisplayName();
    const input = $("#display-name");
    if (input && myName) input.value = myName;
  } catch {
    if (!pos) setSidebarEmpty("Session error — refresh.");
  }

  window.addEventListener("pagehide", () => {
    stopNearbyPolling();
    if (stopLocation) stopLocation();
    teardownChat();
    if (sendCooldownTick) clearInterval(sendCooldownTick);
  });
}

main();
