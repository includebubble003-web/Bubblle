/**
 * Bubblle unified chat shell: sidebar bubbles + room chat + identity.
 */
import { bootstrapSession, cachedDisplayName, updateDisplayName } from "./session.js";
import {
  acquireLocation,
  formatGeolocationError,
  geolocationPermissionState,
  isGeolocationContextOk,
  readCachedPosition,
  requestLocationOnce,
  secureContextHint,
} from "./geo.js";
import {
  hideOnboarding,
  initMapHome,
  onMapBubblesUpdated,
  onMapPositionUpdate,
  showOnboarding,
} from "./map-home.js";

const $ = (sel) => document.querySelector(sel);
const SEARCH_RADIUS_M = 5000;
const NEARBY_POLL_MS = 5000;
const WS_RECONNECT_BASE_MS = 3000;
const WS_RECONNECT_MAX_MS = 20000;
const MSG_COOLDOWN_MS = 1000;
const COMPOSER_MAX_HEIGHT_PX = 144;
const MAX_IMAGE_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_JPEG_QUALITY = 0.85;

const bubbleId = (window.__BUBBLE_ID__ || "").trim() || null;

let myName = "";
const myPreviousNames = new Set();
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
let lastSentReply = null;
let expiryTickTimer = null;
let bubbleExpiresAtMs = null;
let roomInitializedFor = null;
let historyLoadGeneration = 0;

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function mediaUrl(url) {
  if (!url) return "";
  const raw = String(url).trim();
  if (/^https?:\/\//i.test(raw)) {
    if (location.protocol === "https:" && raw.startsWith("http://")) {
      return raw.replace(/^http:\/\//i, "https://");
    }
    return raw;
  }
  return `${location.origin}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

function truncateText(s, max = 80) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function rememberMessage(m) {
  if (m?.id) messageById.set(String(m.id), m);
}

function replyPreviewText(reply) {
  if (reply?.message) return truncateText(reply.message);
  if (reply?.image_url) return "📷 Photo";
  return "";
}

function replyQuoteHtml(reply) {
  if (!reply?.anonymous_name) return "";
  const preview = replyPreviewText(reply);
  const thumb = mediaUrl(reply?.image_url);
  if (!preview && !thumb) return "";
  return `<div class="msg-reply-quote">
    ${thumb ? `<img class="msg-reply-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async" />` : ""}
    <div class="msg-reply-body">
      <span class="msg-reply-author">${escapeHtml(reply.anonymous_name)}</span>
      <span class="msg-reply-text">${escapeHtml(preview || "Photo")}</span>
    </div>
  </div>`;
}

function scrollComposerIntoView() {
  $("#chat-composer")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function messageFromRow(row) {
  if (!row?.dataset.messageId) return null;
  const cached = messageById.get(row.dataset.messageId);
  if (cached) return cached;

  const authorEl = row.querySelector(".msg-author");
  const textEl = row.querySelector(".msg-text");
  const imgEl = row.querySelector(".msg-image");
  const author = authorEl?.textContent?.trim() || (row.classList.contains("msg-bubble-mine") ? myName : "");
  const text = textEl?.textContent || "";
  const imageUrl = imgEl?.getAttribute("src") || null;
  if (!author && !text && !imageUrl) return null;

  return {
    id: row.dataset.messageId,
    anonymous_name: author || "Unknown",
    message: text,
    image_url: imageUrl,
  };
}

function setReplyTarget(m) {
  if (!m?.id || !bubbleActive) return;
  pendingReply = {
    id: String(m.id),
    anonymous_name: m.anonymous_name,
    message: m.message,
    image_url: m.image_url || null,
  };
  const bar = $("#reply-compose");
  const label = $("#reply-compose-label");
  const preview = $("#reply-compose-preview");
  const input = $("#chat-input");
  if (label) label.textContent = `Reply to ${m.anonymous_name}`;
  if (preview) preview.textContent = replyPreviewText(m) || "Message";
  bar?.removeAttribute("hidden");
  setComposerHint("");
  scrollComposerIntoView();
  input?.focus();
  autoResizeComposer();
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

function remainingSecFromExpiresAt(expiresAt) {
  if (!expiresAt) return 0;
  const ms = new Date(expiresAt).getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.floor((ms - Date.now()) / 1000));
}

function setBubbleExpiryFromMeta(b) {
  if (!b) return;
  if (b.expires_at) {
    bubbleExpiresAtMs = new Date(b.expires_at).getTime();
    if (Number.isNaN(bubbleExpiresAtMs)) bubbleExpiresAtMs = null;
  } else if (typeof b.remaining_seconds === "number") {
    bubbleExpiresAtMs = Date.now() + b.remaining_seconds * 1000;
  }
  updateRoomExpiryDisplay();
}

function updateRoomExpiryDisplay() {
  const el = $("#bubble-expiry");
  if (!el) return;
  if (!bubbleExpiresAtMs) {
    el.textContent = "";
    return;
  }
  const sec = Math.max(0, Math.floor((bubbleExpiresAtMs - Date.now()) / 1000));
  el.textContent = fmtRemaining(sec);
  if (sec <= 0 && bubbleActive) {
    bubbleActive = false;
    allowReconnect = false;
    setStatus("This bubble has ended.", true);
    setConnDot("error");
    if (activeSocket) detachSocket(activeSocket);
    activeSocket = null;
  }
}

function updateBubbleExpiryDisplays() {
  document.querySelectorAll("#sidebar-bubbles .sidebar-bubble, #home-bubbles .sidebar-bubble").forEach((li) => {
    const id = li.dataset.bubbleId;
    const b = nearbyBubbles.find((x) => x.id === id);
    const span = li.querySelector(".sidebar-bubble-expiry");
    if (!b || !span) return;
    const sec = b.expires_at ? remainingSecFromExpiresAt(b.expires_at) : (b.remaining_seconds ?? 0);
    span.textContent = fmtRemaining(sec);
  });
}

function tickExpiryUi() {
  updateRoomExpiryDisplay();
  updateBubbleExpiryDisplays();
}

function startExpiryTicker() {
  if (expiryTickTimer) return;
  expiryTickTimer = setInterval(tickExpiryUi, 1000);
}

function stopExpiryTicker() {
  if (expiryTickTimer) {
    clearInterval(expiryTickTimer);
    expiryTickTimer = null;
  }
}

function isMyMessage(anonymousName) {
  if (!anonymousName) return false;
  if (myName && anonymousName === myName) return true;
  return myPreviousNames.has(anonymousName);
}

function trackMyName(name) {
  if (!name) return;
  myName = name;
  myPreviousNames.add(name);
}

function refreshChatIdentity(oldName, newName) {
  for (const [id, m] of messageById) {
    if (m.anonymous_name === oldName) {
      m.anonymous_name = newName;
      messageById.set(id, m);
    }
  }

  document.querySelectorAll("#messages .msg-bubble").forEach((row) => {
    const m = messageById.get(row.dataset.messageId);
    if (!m) return;
    const mine = isMyMessage(m.anonymous_name);
    row.classList.toggle("msg-bubble-mine", mine);
    row.setAttribute("aria-label", `Reply to message from ${m.anonymous_name}`);

    const head = row.querySelector(".msg-bubble-head");
    let author = row.querySelector(".msg-author");
    if (mine) {
      author?.remove();
      return;
    }
    if (!head) return;
    if (!author) {
      author = document.createElement("span");
      author.className = "msg-author";
      head.insertBefore(author, head.firstChild);
    }
    author.textContent = m.anonymous_name;
  });
}

function activeUsers(b) {
  return b.active_users ?? b.online_count ?? 0;
}

/* --- Location (sidebar pill only — no sticky banner) --- */

function setLocPill(state, title = "") {
  const titles = { idle: "Location", loading: "Locating…", ok: "Location on", error: "Location off" };
  const label = title || titles[state] || "";
  for (const id of ["#loc-pill", "#loc-pill-sidebar"]) {
    const el = $(id);
    if (!el) continue;
    el.dataset.state = state;
    el.title = label;
  }
}

function setBrowseEmpty(_text) {
  /* Legacy — map view uses map-empty card instead */
}

function updateRoomAvatar(title) {
  const el = $("#room-avatar");
  if (!el) return;
  const t = String(title || "").trim();
  el.textContent = t ? t.charAt(0).toUpperCase() : "B";
}

function applyPosition(p, { quiet = false } = {}) {
  pos = p;
  $("#f-lat").value = String(p.lat);
  $("#f-lng").value = String(p.lng);
  setLocPill("ok");
  if (!quiet) setBrowseEmpty("");
  hideOnboarding();
  onMapPositionUpdate(p);
  refreshSidebar();
  startNearbyPolling();
  if (bubbleId) {
    onEnterBubble();
    refreshComposerAvailability();
  }
}

function beginLocationWatch() {
  if (stopLocation) stopLocation();
  stopLocation = acquireLocation({
    onUpdate: (p, meta) => applyPosition(p, { quiet: meta.source === "refined" }),
    onError: (err) => {
      if (!bubbleId) showOnboarding(formatGeolocationError(err));
      setLocPill("error");
    },
  });
}

async function startLocation() {
  if (!isGeolocationContextOk()) {
    setLocPill("error", secureContextHint());
    if (!bubbleId) showOnboarding(secureContextHint());
    return;
  }

  const cached = readCachedPosition();
  if (cached) {
    applyPosition(cached, { quiet: true });
    beginLocationWatch();
    return;
  }

  setLocPill("loading");
  if (!bubbleId) {
    const perm = await geolocationPermissionState();
    if (perm === "granted") hideOnboarding();
    else showOnboarding();
  }
  beginLocationWatch();
}

async function ensureLocation({ hint = "Allow location to continue…" } = {}) {
  if (pos) return pos;
  if (!isGeolocationContextOk()) {
    const msg = secureContextHint();
    setLocPill("error", msg);
    setBrowseEmpty(msg);
    throw new Error(msg);
  }
  setLocPill("loading");
    setBrowseEmpty(hint);
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
    setBrowseEmpty(formatGeolocationError(err));
    throw err;
  }
}

/* --- Sidebar --- */

function bubbleInitial(title) {
  const t = String(title || "?").trim();
  return t ? t.charAt(0).toUpperCase() : "?";
}

function bubbleListItemHtml(b) {
  const isActive = bubbleId === b.id;
  const sec = b.expires_at ? remainingSecFromExpiresAt(b.expires_at) : (b.remaining_seconds ?? 0);
  const count = activeUsers(b);
  return `<li class="sidebar-bubble${isActive ? " is-active" : ""}" data-bubble-id="${escapeHtml(b.id)}">
    <a href="/bubble/${b.id}/" class="sidebar-bubble-link">
      <span class="bubble-avatar" aria-hidden="true">${escapeHtml(bubbleInitial(b.title))}</span>
      <span class="bubble-link-body">
        <span class="sidebar-bubble-title">${escapeHtml(b.title)}</span>
        <span class="sidebar-bubble-meta">
          <span class="sidebar-bubble-expiry">${fmtRemaining(sec)}</span>
        </span>
      </span>
      <span class="bubble-online-badge" title="${count} active">
        <span class="bubble-online-dot" aria-hidden="true"></span>
        <span class="sidebar-bubble-count">${count}</span>
      </span>
    </a>
  </li>`;
}

function sortBubblesByActivity(bubbles) {
  return [...bubbles].sort((a, b) => {
    const act = activeUsers(b) - activeUsers(a);
    if (act !== 0) return act;
    return (a.distance_m ?? 0) - (b.distance_m ?? 0);
  });
}

function renderBubbleLists() {
  const ul = $("#sidebar-bubbles");
  if (!ul) return;
  if (!nearbyBubbles.length) {
    ul.innerHTML = "";
    return;
  }
  ul.innerHTML = nearbyBubbles.map((b) => bubbleListItemHtml(b)).join("");
  updateBubbleExpiryDisplays();
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
      setBrowseEmpty("Could not load bubbles.");
      return;
    }
    const data = await res.json();
    nearbyBubbles = sortBubblesByActivity(data.results || []);
    renderBubbleLists();
    onMapBubblesUpdated(nearbyBubbles);
  } catch {
    onMapBubblesUpdated([]);
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

function setIdentityError(hasError) {
  for (const id of ["#display-name", "#display-name-map"]) {
    const el = $(id);
    if (!el) continue;
    el.classList.toggle("identity-input-error", hasError);
  }
}

async function saveName() {
  const input = $("#display-name") || $("#display-name-map");
  if (!input) return;
  const trimmed = (input.value || "").trim();
  if (trimmed.length < 2) {
    setIdentityError(true);
    return;
  }
  setIdentityError(false);
  const previousName = myName;
  try {
    const data = await updateDisplayName(trimmed);
    const newName = data.anonymous_name;
    trackMyName(newName);
    syncNameInputs(newName);
    if (previousName && previousName !== newName) {
      refreshChatIdentity(previousName, newName);
    }
    for (const id of ["#display-name", "#display-name-map"]) {
      const el = $(id);
      if (!el) continue;
      el.classList.add("identity-saved");
      setTimeout(() => el.classList.remove("identity-saved"), 600);
    }
  } catch {
    setIdentityError(true);
  }
}

function flushPendingBubbleIntro() {
  if (!bubbleId || !pos || !isWsOpen()) return;
  const key = `bubble-intro-${bubbleId}`;
  const text = sessionStorage.getItem(key)?.trim();
  if (!text) return;
  sessionStorage.removeItem(key);
  sendChat(text);
}

function syncNameInputs(value) {
  for (const id of ["#display-name", "#display-name-map"]) {
    const el = $(id);
    if (el && el.value !== value) el.value = value;
  }
}

function setupIdentity() {
  for (const sel of ["#display-name", "#display-name-map"]) {
    const input = $(sel);
    if (!input) continue;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        syncNameInputs(input.value);
        saveName();
      }
    });
    input.addEventListener("blur", () => {
      syncNameInputs(input.value);
      if (input.value.trim() !== myName) saveName();
    });
    input.addEventListener("input", () => syncNameInputs(input.value));
  }
  $("#btn-save-name")?.addEventListener("click", () => {
    syncNameInputs($("#display-name")?.value || $("#display-name-map")?.value || "");
    saveName();
  });
}

/* --- Chat room UI --- */

function showWelcome() {
  clearReply();
  roomInitializedFor = null;
  historyLoadGeneration += 1;
  messageById.clear();
  teardownChat();
}

function showThread() {
  const panel = $("#chat-panel");
  const thread = $("#chat-thread");
  panel?.classList.remove("chat-panel--idle");
  thread?.removeAttribute("hidden");
  $("#chat-composer")?.removeAttribute("hidden");
  getComposerInput()?.removeAttribute("disabled");
  refreshComposerAvailability();
  autoResizeComposer();
}

function refreshComposerAvailability() {
  const ready = !!pos && bubbleActive && !isSendOnCooldown();
  setSendEnabled(ready);
  if (isSendOnCooldown()) return;
  if (!pos && bubbleId && bubbleActive) {
    setComposerHint("Waiting for location to send messages…", { kind: "info" });
  } else if (bubbleActive) {
    setComposerHint("");
  }
}

function setConnDot(state, title = "") {
  const labels = { idle: "Offline", loading: "Connecting…", ok: "Live", error: "Disconnected" };
  const el = $("#conn-dot");
  const badge = $("#conn-badge");
  const label = $("#conn-label");
  if (el) {
    el.dataset.state = state;
    el.title = title || labels[state] || state;
  }
  if (badge) badge.dataset.state = state;
  if (label) label.textContent = title || labels[state] || state;
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

function setMediaButtonsEnabled(on) {
  for (const id of ["#btn-image-gallery", "#btn-image-camera"]) {
    const btn = $(id);
    if (!btn) continue;
    btn.disabled = !on;
  }
}

function setSendEnabled(on) {
  const btn = $("#btn-send");
  if (btn) btn.disabled = !on;
  setMediaButtonsEnabled(on);
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
    refreshComposerAvailability();
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
    requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
  });
}

function messageBodyHtml(m) {
  let html = "";
  const imageUrl = mediaUrl(m.image_url);
  if (imageUrl) {
    const alt = m.message ? escapeHtml(truncateText(m.message, 80)) : "Photo";
    const pendingClass = m._pending ? " msg-image-pending" : "";
    html += `<a class="msg-image-link" href="${escapeHtml(imageUrl)}" target="_blank" rel="noopener noreferrer">
      <img class="msg-image${pendingClass}" src="${escapeHtml(imageUrl)}" alt="${alt}" loading="eager" decoding="async" />
    </a>`;
  }
  if (m.message) {
    html += `<p class="msg-text">${escapeHtml(m.message)}</p>`;
  }
  return html;
}

function removeMessageById(id) {
  if (!id) return;
  messageById.delete(String(id));
  document.querySelector(`[data-message-id="${id}"]`)?.remove();
}

function wireMessageImage(img) {
  if (!img || img.dataset.wired) return;
  img.dataset.wired = "1";
  img.addEventListener("error", () => {
    if (img.dataset.retried) {
      img.classList.add("msg-image-broken");
      return;
    }
    img.dataset.retried = "1";
    const src = img.getAttribute("src");
    if (!src) return;
    const normalized = mediaUrl(src);
    if (normalized && normalized !== src) {
      img.src = normalized;
    }
  });
}

function appendMessage(m, opts = { scroll: true }) {
  if (m?.id && messageById.has(String(m.id))) return;
  clearMessagesPlaceholder();
  const imageUrl = mediaUrl(m.image_url);
  rememberMessage({ ...m, image_url: imageUrl || m.image_url || null });
  const list = $("#messages");
  const mine = isMyMessage(m.anonymous_name);
  const row = document.createElement("div");
  row.className = `msg-bubble${mine ? " msg-bubble-mine" : ""}${imageUrl ? " msg-bubble-has-image" : ""}`;
  row.dataset.messageId = String(m.id);
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  row.setAttribute("aria-label", `Reply to message from ${m.anonymous_name}`);
  const t = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  row.innerHTML = `
    <div class="msg-bubble-inner">
      ${replyQuoteHtml(m.reply_to)}
      <div class="msg-bubble-head">
        ${mine ? "" : `<span class="msg-author">${escapeHtml(m.anonymous_name)}</span>`}
        <button type="button" class="msg-reply-btn" aria-label="Reply to this message">
          <svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
          <span>Reply</span>
        </button>
      </div>
      ${messageBodyHtml(m)}
      <span class="msg-time">${t}</span>
    </div>`;
  list.appendChild(row);
  wireMessageImage(row.querySelector(".msg-image"));
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
    flushPendingBubbleIntro();
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
      if (isMyMessage(data.payload?.anonymous_name)) keepComposerFocus();
      lastSentReply = null;
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
      else if (data.code === "invalid_reply") {
        if (lastSentReply) setReplyTarget(lastSentReply);
        lastSentReply = null;
        setComposerHint("Could not reply to that message.", { kind: "cooldown" });
      }
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

function isImageFile(file) {
  if (!file) return false;
  if (file.type?.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(file.name || "");
}

async function compressImageFile(file) {
  if (!isImageFile(file)) {
    throw new Error("Please choose a photo.");
  }
  if (file.size > MAX_IMAGE_INPUT_BYTES) {
    throw new Error("Photo is too large (max 8 MB).");
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // iOS HEIC / older browsers: upload original and let the server optimize.
    return file;
  }

  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not compress photo."))),
      "image/jpeg",
      IMAGE_JPEG_QUALITY
    );
  });
  return blob;
}

async function uploadChatImage(file) {
  if (!bubbleId) return;
  if (!bubbleActive) {
    setComposerHint("This bubble has ended.", { kind: "cooldown" });
    return;
  }
  if (!pos) {
    setComposerHint("Allow location to send photos, then try again.", { kind: "cooldown" });
    return;
  }
  if (isSendOnCooldown()) {
    refreshCooldownUi();
    return;
  }

  const replySnapshot = pendingReply ? { ...pendingReply } : null;
  const caption = $("#chat-input")?.value.trim() || "";
  let pendingId = null;
  let localPreview = null;

  setMediaButtonsEnabled(false);
  setComposerHint("Preparing photo…", { kind: "info" });

  try {
    const blob = await compressImageFile(file);
    const uploadName = blob.name || file.name || "photo.jpg";
    localPreview = URL.createObjectURL(blob);
    pendingId = `pending-${Date.now()}`;
    appendMessage({
      id: pendingId,
      anonymous_name: myName || "You",
      message: caption,
      image_url: localPreview,
      created_at: new Date().toISOString(),
      _pending: true,
    });
    setComposerHint("Uploading photo…", { kind: "info" });

    const fd = new FormData();
    fd.append("image", blob, uploadName);
    fd.append("latitude", String(pos.lat));
    fd.append("longitude", String(pos.lng));
    if (caption) fd.append("message", caption);
    if (replySnapshot?.id) fd.append("reply_to", replySnapshot.id);

    const res = await fetch(`/api/bubbles/${bubbleId}/messages/image/`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });

    removeMessageById(pendingId);
    pendingId = null;

    if (!res.ok) {
      let detail = "Could not upload photo.";
      try {
        const err = await res.json();
        if (err.detail) detail = err.detail;
      } catch {
        /* ignore */
      }
      setComposerHint(detail, { kind: "cooldown" });
      return;
    }

    const msg = await res.json();
    if (!msg.image_url) {
      setComposerHint("Photo uploaded but preview is unavailable.", { kind: "cooldown" });
    } else {
      setComposerHint("");
    }
    startSendCooldown();
    lastSentReply = replySnapshot;
    clearReply();
    if ($("#chat-input")) resetComposerInput({ keepFocus: true });
    appendMessage(msg);
  } catch (err) {
    removeMessageById(pendingId);
    setComposerHint(err.message || "Could not upload photo.", { kind: "cooldown" });
  } finally {
    if (localPreview) URL.revokeObjectURL(localPreview);
    refreshComposerAvailability();
  }
}

function openMediaPicker(inputEl) {
  if (!bubbleId) return;
  if (!bubbleActive) {
    setComposerHint("This bubble has ended.", { kind: "cooldown" });
    return;
  }
  if (!pos) {
    setComposerHint("Allow location to send photos, then try again.", { kind: "cooldown" });
    return;
  }
  if (isSendOnCooldown()) {
    refreshCooldownUi();
    return;
  }
  inputEl?.click();
}

function setupMediaUpload() {
  const galleryInput = $("#image-gallery-input");
  const cameraInput = $("#image-camera-input");

  $("#btn-image-gallery")?.addEventListener("click", () => {
    openMediaPicker(galleryInput);
  });

  $("#btn-image-camera")?.addEventListener("click", () => {
    openMediaPicker(cameraInput);
  });

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await uploadChatImage(file);
  };

  galleryInput?.addEventListener("change", onPick);
  cameraInput?.addEventListener("change", onPick);
}

function getComposerInput() {
  return $("#chat-input");
}

function autoResizeComposer() {
  const el = getComposerInput();
  if (!el) return;
  el.style.height = "auto";
  const next = Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX);
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight > COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
}

function resetComposerInput({ keepFocus = true } = {}) {
  const el = getComposerInput();
  if (!el) return;
  el.value = "";
  autoResizeComposer();
  if (!keepFocus) return;
  requestAnimationFrame(() => {
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  });
}

function keepComposerFocus() {
  const el = getComposerInput();
  if (!el || el.disabled) return;
  requestAnimationFrame(() => {
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  });
}

function submitComposerMessage() {
  const el = getComposerInput();
  const text = el?.value.trim();
  if (!text || !bubbleId) return;
  if (!pos) {
    setComposerHint("Waiting for location…", { kind: "info" });
    return;
  }
  if (!bubbleActive) return;
  if (isSendOnCooldown()) {
    refreshCooldownUi();
    return;
  }
  sendChat(text);
  resetComposerInput({ keepFocus: true });
  scrollMessages();
}

function sendChat(text) {
  if (!text || !pos) return;
  if (isSendOnCooldown()) {
    refreshCooldownUi();
    return;
  }
  const replySnapshot = pendingReply ? { ...pendingReply } : null;
  if (isWsOpen()) {
    activeSocket.send(JSON.stringify(chatPayload(text, replySnapshot)));
    activeSocket.send(
      JSON.stringify({ type: "typing", typing: false, latitude: pos.lat, longitude: pos.lng })
    );
    lastSentReply = replySnapshot;
    clearReply();
    return;
  }
  outboundQueue.push({ kind: "chat", text, replyTo: replySnapshot });
  lastSentReply = replySnapshot;
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
      updateRoomAvatar(b.title);
      setBubbleExpiryFromMeta(b);
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

function createMessagesPlaceholder(text = "Loading messages…") {
  const wrap = document.createElement("div");
  wrap.className = "messages-placeholder state-panel";
  wrap.id = "messages-placeholder";
  wrap.innerHTML = `<div class="state-icon state-icon-pulse" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v6h-6"/></svg>
  </div><p class="state-text muted">${escapeHtml(text)}</p>`;
  return wrap;
}

function loadHistory() {
  if (!bubbleId) return;
  const ph = $("#messages-placeholder");
  const textEl = ph?.querySelector(".state-text");
  if (textEl) textEl.textContent = "Loading messages…";
  else if (ph) ph.textContent = "Loading messages…";

  const gen = ++historyLoadGeneration;
  const forBubble = bubbleId;

  fetch(`/api/bubbles/${bubbleId}/messages/?limit=80`, { credentials: "include" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (gen !== historyLoadGeneration || forBubble !== bubbleId) return;
      clearMessagesPlaceholder();
      const wrap = $("#messages");
      wrap.innerHTML = "";
      messageById.clear();
      if (!data?.results?.length) {
        const empty = createMessagesPlaceholder("No messages yet — say hello!");
        empty.querySelector(".state-icon")?.classList.remove("state-icon-pulse");
        empty.querySelector(".state-text").textContent = "No messages yet — say hello!";
        wrap.appendChild(empty);
        return;
      }
      for (const m of data.results) appendMessage(m, { scroll: false });
      scrollMessages();
    })
    .catch(() => {
      if (gen !== historyLoadGeneration || forBubble !== bubbleId) return;
      clearMessagesPlaceholder();
    });
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

  // GPS refines a second after join — do not wipe chat on every position update.
  if (roomInitializedFor === bubbleId) {
    loadBubbleMeta();
    if (pos && !isWsOpen() && allowReconnect) connectWs();
    return;
  }

  roomInitializedFor = bubbleId;
  messageById.clear();
  clearReply();
  const messages = $("#messages");
  if (messages) {
    messages.innerHTML = "";
    messages.appendChild(createMessagesPlaceholder());
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

  if (bubbleId && window.matchMedia("(max-width: 900px)").matches) {
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
    if (!row?.dataset.messageId) return;
    if (!bubbleActive) {
      setComposerHint("This bubble has ended.", { kind: "muted" });
      return;
    }
    const m = messageFromRow(row);
    if (m) setReplyTarget(m);
  };

  list.addEventListener("click", (e) => {
    if (e.target.closest(".msg-reply-btn")) {
      e.preventDefault();
      e.stopPropagation();
    }
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
  const input = getComposerInput();
  const form = $("#chat-form");

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    submitComposerMessage();
  });

  input?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      submitComposerMessage();
    }
  });

  input?.addEventListener("input", () => {
    autoResizeComposer();
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

  autoResizeComposer();

  const sendBtn = $("#btn-send");
  sendBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    submitComposerMessage();
  });
}

async function refreshNearbyBubbles() {
  try {
    if (!pos) await ensureLocation({ hint: "Allow location to see nearby bubbles…" });
    await refreshSidebar();
  } catch {
    /* map onboarding shows errors */
  }
}

async function main() {
  setupIdentity();
  setupDrawer();
  setupReplyComposer();
  setupMessageReplies();
  setupComposer();
  setupMediaUpload();

  initMapHome({
    isRoom: () => !!bubbleId,
    hasPosition: () => !!pos,
    getPosition: () => pos,
    getNearbyBubbles: () => nearbyBubbles,
    readCachedPosition,
    onPosition: (p) => applyPosition(p, { quiet: true }),
    startLocation,
    ensureLocation,
    saveName,
  });

  if (bubbleId) {
    showThread();
  } else {
    showWelcome();
  }

  startExpiryTicker();
  startLocation();

  try {
    const session = await bootstrapSession();
    trackMyName(session.anonymous_name || cachedDisplayName());
    if (myName) syncNameInputs(myName);
  } catch {
    if (!pos && !bubbleId) showOnboarding("Session error — refresh the page.");
  }

  window.addEventListener("pagehide", () => {
    stopNearbyPolling();
    stopExpiryTicker();
    if (stopLocation) stopLocation();
    teardownChat();
    if (sendCooldownTick) clearInterval(sendCooldownTick);
  });
}

main();
