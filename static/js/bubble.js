import { bootstrapSession, showWhoami } from "./session.js";
import {
  acquireLocation,
  formatGeolocationError,
  isGeolocationContextOk,
  readCachedPosition,
  secureContextHint,
} from "./geo.js";

const bubbleId = window.__BUBBLE_ID__;
const $ = (sel) => document.querySelector(sel);

<<<<<<< Updated upstream
const WS_RECONNECT_BASE_MS = 3000;
const WS_RECONNECT_MAX_MS = 20000;
=======
<<<<<<< Updated upstream
const WS_RECONNECT_BASE_MS = 1000;
const WS_RECONNECT_MAX_MS = 15000;
const POS_CACHE_KEY = "bbl_last_pos";
=======
const WS_RECONNECT_BASE_MS = 3000;
const WS_RECONNECT_MAX_MS = 20000;
/** Matches server `throttle_allow(..., 2)` in bubbles/consumers.py */
const MSG_COOLDOWN_MS = 2000;
>>>>>>> Stashed changes
>>>>>>> Stashed changes

let pos = null;
let activeSocket = null;
let typingTimer = null;
let lastTypingSent = 0;
let reconnectTimer = null;
let reconnectAttempt = 0;
let allowReconnect = true;
let bubbleActive = true;
const outboundQueue = [];
<<<<<<< Updated upstream
let stopLocation = null;
=======
<<<<<<< Updated upstream

// --- UI helpers (sync, never await) ---
=======
let stopLocation = null;
let sendCooldownUntil = 0;
let sendCooldownTick = null;
>>>>>>> Stashed changes
>>>>>>> Stashed changes

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Fixed-size dot — no layout shift (replaces connecting/reconnecting text). */
function setConnDot(state, title = "") {
  const el = $("#conn-dot");
  if (!el) return;
  el.dataset.state = state;
  const labels = {
    loading: "Connecting",
    ok: "Connected",
    error: "Disconnected",
    idle: "Offline",
  };
  el.title = title || labels[state] || "";
}

function setActiveUsers(n) {
  const el = $("#online-count");
  if (el) el.textContent = `${Number(n) || 0} active`;
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

function setSendEnabled(enabled) {
  const btn = $("#btn-send");
  if (btn) btn.disabled = !enabled;
}

function setComposerHint(msg, { kind = "muted" } = {}) {
  const el = $("#composer-hint");
  if (!el) return;
  if (!msg) {
    if (isSendOnCooldown() && el.dataset.kind === "cooldown") return;
    el.hidden = true;
    el.textContent = "";
    el.dataset.kind = "";
    el.className = "composer-hint muted";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
  el.dataset.kind = kind === "cooldown" ? "cooldown" : "info";
  el.className = kind === "warn" || kind === "cooldown" ? "composer-hint composer-hint-warn" : "composer-hint muted";
}

function refreshCooldownUi() {
  if (!isSendOnCooldown()) {
    if (sendCooldownTick) {
      clearInterval(sendCooldownTick);
      sendCooldownTick = null;
    }
    setSendEnabled(true);
    setComposerHint("");
    return;
  }
  const sec = Math.max(1, Math.ceil((sendCooldownUntil - Date.now()) / 1000));
  setComposerHint(`Wait ${sec}s before sending again`, { kind: "cooldown" });
}

function startSendCooldown() {
  sendCooldownUntil = Date.now() + MSG_COOLDOWN_MS;
  setSendEnabled(false);
  refreshCooldownUi();
  if (sendCooldownTick) clearInterval(sendCooldownTick);
  sendCooldownTick = setInterval(refreshCooldownUi, 250);
}

function clearMessagesPlaceholder() {
  $("#messages-placeholder")?.remove();
}

function appendMessage(m, opts = { scroll: true }) {
  clearMessagesPlaceholder();
  const wrap = $("#messages");
  const row = document.createElement("div");
  row.className = "msg";
  const t = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  row.innerHTML = `
    <div class="msg-meta"><span class="msg-name">${escapeHtml(m.anonymous_name)}</span><span class="msg-time">${t}</span></div>
    <div class="msg-body">${escapeHtml(m.message)}</div>`;
  wrap.appendChild(row);
  if (opts.scroll) {
    requestAnimationFrame(() => {
      wrap.scrollTop = wrap.scrollHeight;
    });
  }
}

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
  if (code === 4401) return "Refresh the page and allow cookies.";
  if (code === 4403) return "You are outside this bubble. Move closer and refresh.";
  if (code === 4404) return "This bubble has ended.";
  return "Cannot join this chat.";
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
  socket.onopen = null;
  socket.onclose = null;
  socket.onerror = null;
  socket.onmessage = null;
  try {
    socket.close();
  } catch {
    /* ignore */
  }
}

function flushOutboundQueue() {
<<<<<<< Updated upstream
  if (!isWsOpen() || !pos) return;
  while (outboundQueue.length) {
    const item = outboundQueue.shift();
    if (item.kind === "chat") {
      activeSocket.send(
        JSON.stringify({
          type: "chat",
          message: item.text,
          latitude: pos.lat,
          longitude: pos.lng,
        })
      );
    }
=======
  if (!isWsOpen() || !pos || outboundQueue.length === 0) return;
  if (isSendOnCooldown()) return;
  const item = outboundQueue.shift();
  if (item?.kind === "chat") {
    activeSocket.send(
      JSON.stringify({
        type: "chat",
        message: item.text,
        latitude: pos.lat,
        longitude: pos.lng,
      })
    );
    startSendCooldown();
>>>>>>> Stashed changes
  }
}

function scheduleReconnect() {
  if (!allowReconnect || !pos || !bubbleActive || reconnectTimer) return;
  const delay = Math.min(WS_RECONNECT_BASE_MS * 2 ** reconnectAttempt, WS_RECONNECT_MAX_MS);
  reconnectAttempt += 1;
  setConnDot("loading", `Reconnecting (${Math.ceil(delay / 1000)}s)`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs();
  }, delay);
}

function connectWs() {
  if (!pos || !bubbleActive || !allowReconnect || isWsBusy()) return;

  setConnDot("loading", "Connecting");

  const socket = new WebSocket(wsUrl());
  activeSocket = socket;

  socket.onopen = () => {
    if (activeSocket !== socket) return;
    reconnectAttempt = 0;
    setConnDot("ok", "Connected");
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
      setConnDot("error", "Disconnected");
      return;
    }
    setConnDot("loading", "Reconnecting");
    scheduleReconnect();
  };

  socket.onerror = () => {
    /* onclose handles state */
  };

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
      if (typeof n === "number") setActiveUsers(n);
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
      else if (data.code === "out_of_radius") setStatus("You moved outside the bubble radius.", true);
      else if (data.code === "bubble_closed") {
        bubbleActive = false;
        allowReconnect = false;
        detachSocket(socket);
        activeSocket = null;
        setStatus("This bubble has expired.", true);
        setConnDot("error", "Ended");
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
    activeSocket.send(
      JSON.stringify({ type: "chat", message: text, latitude: pos.lat, longitude: pos.lng })
    );
    activeSocket.send(
      JSON.stringify({ type: "typing", typing: false, latitude: pos.lat, longitude: pos.lng })
    );
    startSendCooldown();
    return;
  }
  outboundQueue.push({ kind: "chat", text });
<<<<<<< Updated upstream
  setComposerHint("Will send when connected…");
<<<<<<< Updated upstream
  if (allowReconnect && bubbleActive) connectWs();
=======
  if (pos && bubbleActive) connectWs();
=======
  setComposerHint("Will send when connected…", { kind: "info" });
  if (allowReconnect && bubbleActive) connectWs();
>>>>>>> Stashed changes
>>>>>>> Stashed changes
}

function sendTyping(typing) {
  if (!isWsOpen() || !pos) return;
  activeSocket.send(
    JSON.stringify({ type: "typing", typing, latitude: pos.lat, longitude: pos.lng })
  );
}

function positionChanged(a, b) {
  return Math.abs(a.lat - b.lat) > 0.0002 || Math.abs(a.lng - b.lng) > 0.0002;
}

function applyPosition(p, { reconnectWs = false } = {}) {
  const prev = pos;
  pos = p;
  loadBubbleMeta();
  if (!prev) {
    connectWs();
    return;
  }
  if (reconnectWs && positionChanged(prev, p) && isWsBusy()) {
    if (activeSocket) detachSocket(activeSocket);
    activeSocket = null;
    reconnectAttempt = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    connectWs();
  }
}

function loadBubbleMeta() {
  if (!pos) return;
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
      if (b.distance_m != null) {
        $("#bubble-sub").textContent = `Radius ${b.radius} m · ~${Math.round(b.distance_m)} m from center`;
      }
      if (b.remaining_seconds != null) {
        const m = Math.floor(b.remaining_seconds / 60);
        const s = b.remaining_seconds % 60;
        $("#bubble-expiry").textContent = `${m}m ${s}s left`;
      }
      const users = b.active_users ?? b.online_count;
      if (typeof users === "number") setActiveUsers(users);
      if (!b.active) {
        bubbleActive = false;
        allowReconnect = false;
        if (activeSocket) detachSocket(activeSocket);
        activeSocket = null;
        setStatus("This bubble has expired.", true);
        setConnDot("error", "Ended");
      } else if (b.distance_m != null && b.distance_m > b.radius) {
        stopReconnecting("Outside bubble — move closer and refresh.");
      }
    })
    .catch(() => {});
}

function loadHistory() {
  fetch(`/api/bubbles/${bubbleId}/messages/?limit=80`, { credentials: "include" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data?.results?.length) {
        clearMessagesPlaceholder();
        if (!$("#messages").children.length) {
          const p = document.createElement("p");
          p.className = "messages-placeholder muted";
          p.textContent = "No messages yet. Say hello!";
          $("#messages").appendChild(p);
        }
        return;
      }
      clearMessagesPlaceholder();
      const wrap = $("#messages");
      wrap.innerHTML = "";
      for (const m of data.results) appendMessage(m, { scroll: false });
      requestAnimationFrame(() => {
        wrap.scrollTop = wrap.scrollHeight;
      });
    })
    .catch(() => clearMessagesPlaceholder());
}

function startLocation() {
  if (!isGeolocationContextOk()) {
    setStatus(secureContextHint(), true);
    setConnDot("error", "No location");
    return;
  }

  const cached = readCachedPosition();
  if (cached) applyPosition(cached);

  if (stopLocation) stopLocation();
  stopLocation = acquireLocation({
    onUpdate: (p, meta) => {
      applyPosition(p, { reconnectWs: meta.source === "refined" });
    },
    onError: (err) => {
      if (!pos) {
        setStatus(formatGeolocationError(err), true);
        setConnDot("error", "No location");
      }
    },
  });
}

function setupComposer() {
  $("#chat-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = $("#chat-input").value.trim();
    if (!text) return;
    if (!pos) {
      setComposerHint("Waiting for location…");
      startLocation();
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

  $("#chat-input").addEventListener("input", () => {
    if (!isWsOpen()) return;
    const now = Date.now();
    if (now - lastTypingSent > 2500) {
      sendTyping(true);
      lastTypingSent = now;
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => sendTyping(false), 1600);
  });
}

function main() {
  setupComposer();
  setConnDot("loading", "Waiting for location");
  loadHistory();

  bootstrapSession()
    .then(() => showWhoami())
    .catch(() => setStatus("Session error. Refresh the page.", true));

  startLocation();
}

window.addEventListener("pagehide", () => {
  allowReconnect = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
<<<<<<< Updated upstream
  if (stopLocation) stopLocation();
  if (activeSocket) detachSocket(activeSocket);
  activeSocket = null;
=======
<<<<<<< Updated upstream
  if (ws) ws.close();
=======
  if (sendCooldownTick) clearInterval(sendCooldownTick);
  if (stopLocation) stopLocation();
  if (activeSocket) detachSocket(activeSocket);
  activeSocket = null;
>>>>>>> Stashed changes
>>>>>>> Stashed changes
});

main();
