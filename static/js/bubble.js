import { bootstrapSession, showWhoami } from "./session.js";
import {
  formatGeolocationError,
  getCurrentPosition,
  isGeolocationContextOk,
  secureContextHint,
} from "./geo.js";

const bubbleId = window.__BUBBLE_ID__;
const $ = (sel) => document.querySelector(sel);

const WS_RECONNECT_BASE_MS = 1000;
const WS_RECONNECT_MAX_MS = 15000;
const POS_CACHE_KEY = "bbl_last_pos";

let pos = null;
let ws = null;
let typingTimer = null;
let lastTypingSent = 0;
let reconnectTimer = null;
let reconnectAttempt = 0;
let intentionalClose = false;
let bubbleActive = true;
let historyLoaded = false;
const outboundQueue = [];

// --- UI helpers (sync, never await) ---

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setChip(id, text, visible = true) {
  const el = $(id);
  if (!el) return;
  if (!visible || !text) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function setWsChip(text) {
  setChip("#ws-status", text, Boolean(text));
}

function setHistoryChip(text) {
  setChip("#history-status", text, Boolean(text));
}

function setActiveUsers(n) {
  const el = $("#online-count");
  if (!el) return;
  el.textContent = `${Number(n) || 0} active`;
}

function setStatus(msg, show) {
  const s = $("#chat-status");
  if (!s) return;
  s.hidden = !show;
  s.textContent = msg || "";
}

function setComposerHint(msg) {
  const el = $("#composer-hint");
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || "";
}

function clearMessagesPlaceholder() {
  const ph = $("#messages-placeholder");
  if (ph) ph.remove();
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

function readCachedPosition() {
  try {
    const raw = sessionStorage.getItem(POS_CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.lat === "number" && typeof p?.lng === "number") return p;
  } catch {
    /* ignore */
  }
  return null;
}

function cachePosition(p) {
  try {
    sessionStorage.setItem(POS_CACHE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/bubble/${bubbleId}/?lat=${encodeURIComponent(pos.lat)}&lng=${encodeURIComponent(pos.lng)}`;
}

function isWsOpen() {
  return ws && ws.readyState === WebSocket.OPEN;
}

function flushOutboundQueue() {
  if (!isWsOpen() || !pos) return;
  while (outboundQueue.length) {
    const item = outboundQueue.shift();
    if (item.kind === "chat") {
      ws.send(
        JSON.stringify({
          type: "chat",
          message: item.text,
          latitude: pos.lat,
          longitude: pos.lng,
        })
      );
    }
  }
  setComposerHint("");
}

function scheduleReconnect() {
  if (intentionalClose || !pos || !bubbleActive) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = Math.min(WS_RECONNECT_BASE_MS * 2 ** reconnectAttempt, WS_RECONNECT_MAX_MS);
  reconnectAttempt += 1;
  setWsChip(`Reconnecting in ${Math.ceil(delay / 1000)}s…`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs();
  }, delay);
}

function connectWs() {
  if (!pos || !bubbleActive) return;

  if (ws) {
    intentionalClose = true;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
    intentionalClose = false;
  }

  setWsChip("Connecting…");

  try {
    ws = new WebSocket(wsUrl());
  } catch {
    setWsChip("Connection failed");
    scheduleReconnect();
    return;
  }

  ws.addEventListener("open", () => {
    reconnectAttempt = 0;
    setWsChip("");
    flushOutboundQueue();
  });

  ws.addEventListener("close", () => {
    setWsChip("Disconnected");
    if (!intentionalClose && bubbleActive) {
      scheduleReconnect();
    }
  });

  ws.addEventListener("error", () => {
    setWsChip("Connection error");
  });

  ws.addEventListener("message", (ev) => {
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
      if (data.code === "slow_down") setStatus("Sending too fast.", true);
      else if (data.code === "out_of_radius") setStatus("You moved outside the bubble radius.", true);
      else if (data.code === "bubble_closed") {
        bubbleActive = false;
        setStatus("This bubble has expired.", true);
      }
    }
  });
}

function sendChat(text) {
  if (!text || !pos) return;
  if (isWsOpen()) {
    ws.send(
      JSON.stringify({
        type: "chat",
        message: text,
        latitude: pos.lat,
        longitude: pos.lng,
      })
    );
    ws.send(
      JSON.stringify({ type: "typing", typing: false, latitude: pos.lat, longitude: pos.lng })
    );
    return;
  }
  outboundQueue.push({ kind: "chat", text });
  setComposerHint("Will send when connected…");
  if (pos && bubbleActive) connectWs();
}

function sendTyping(typing) {
  if (!isWsOpen() || !pos) return;
  ws.send(
    JSON.stringify({
      type: "typing",
      typing,
      latitude: pos.lat,
      longitude: pos.lng,
    })
  );
}

// --- Background tasks (never block UI init) ---

function loadBubbleMeta() {
  if (!pos) return;
  const q = new URLSearchParams({ lat: String(pos.lat), lng: String(pos.lng) });
  fetch(`/api/bubbles/${bubbleId}/?${q}`, { credentials: "include" })
    .then((res) => {
      if (!res.ok) {
        $("#bubble-title").textContent = "Not found";
        return null;
      }
      return res.json();
    })
    .then((b) => {
      if (!b) return;
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
        setStatus("This bubble has expired.", true);
        intentionalClose = true;
        if (ws) ws.close();
      }
    })
    .catch(() => {
      /* meta is non-critical for chat */
    });
}

function loadHistory() {
  setHistoryChip("Loading messages…");
  fetch(`/api/bubbles/${bubbleId}/messages/?limit=80`, { credentials: "include" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      historyLoaded = true;
      setHistoryChip("");
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
    .catch(() => {
      setHistoryChip("");
      clearMessagesPlaceholder();
    });
}

function onPositionReady(p) {
  pos = p;
  cachePosition(p);
  loadBubbleMeta();
  connectWs();
}

function resolveLocation() {
  const cached = readCachedPosition();
  if (cached) onPositionReady(cached);

  if (!isGeolocationContextOk()) {
    if (!cached) setStatus(secureContextHint(), true);
    return;
  }

  getCurrentPosition()
    .then((p) => onPositionReady(p))
    .catch((err) => {
      if (!pos) setStatus(formatGeolocationError(err), true);
    });
}

function setupComposer() {
  $("#chat-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const input = $("#chat-input");
    const text = input.value.trim();
    if (!text) return;
    if (!pos) {
      setComposerHint("Waiting for location…");
      return;
    }
    if (!bubbleActive) return;
    sendChat(text);
    input.value = "";
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

function initChatShell() {
  setupComposer();
  setWsChip("Connecting…");
  setHistoryChip("Loading messages…");
  loadHistory();
}

function main() {
  initChatShell();

  bootstrapSession()
    .then(() => showWhoami())
    .catch(() => setStatus("Session error. Refresh the page.", true));

  resolveLocation();
}

window.addEventListener("pagehide", () => {
  intentionalClose = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) ws.close();
});

main();
