import { bootstrapSession, showWhoami } from "./session.js";

const bubbleId = window.__BUBBLE_ID__;
const $ = (sel) => document.querySelector(sel);

let pos = null;
let ws = null;
let typingTimer = null;
let lastTypingSent = 0;

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function appendMessage(m, opts = { scroll: true }) {
  const wrap = $("#messages");
  const row = document.createElement("div");
  row.className = "msg";
  const t = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  row.innerHTML = `
    <div class="msg-meta"><span class="msg-name">${escapeHtml(m.anonymous_name)}</span><span class="msg-time">${t}</span></div>
    <div class="msg-body">${escapeHtml(m.message)}</div>`;
  wrap.appendChild(row);
  if (opts.scroll) wrap.scrollTop = wrap.scrollHeight;
}

function setOnline(n) {
  const el = $("#online-count");
  el.textContent = `${n} online`;
}

function setStatus(msg, show) {
  const s = $("#chat-status");
  s.hidden = !show;
  s.textContent = msg || "";
}

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const lat = pos.lat;
  const lng = pos.lng;
  return `${proto}//${location.host}/ws/bubble/${bubbleId}/?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`;
}

function connectWs() {
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
  ws = new WebSocket(wsUrl());
  ws.addEventListener("open", () => {
    setStatus("", false);
    $("#chat-input").disabled = false;
    $("form#chat-form button").disabled = false;
  });
  ws.addEventListener("close", () => {
    $("#chat-input").disabled = true;
    $("form#chat-form button").disabled = true;
    setStatus("Disconnected. Reopen when you are back in range.", true);
  });
  ws.addEventListener("error", () => {
    setStatus("Connection error.", true);
  });
  ws.addEventListener("message", (ev) => {
    const data = JSON.parse(ev.data);
    if (data.type === "chat") {
      appendMessage(data.payload);
      $("#typing").hidden = true;
    } else if (data.type === "presence") {
      if (typeof data.online === "number") setOnline(data.online);
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
    }
  });
}

async function loadBubbleMeta() {
  if (!pos) return;
  const q = new URLSearchParams({ lat: String(pos.lat), lng: String(pos.lng) });
  const res = await fetch(`/api/bubbles/${bubbleId}/?${q}`, { credentials: "include" });
  if (!res.ok) {
    $("#bubble-title").textContent = "Not found";
    return;
  }
  const b = await res.json();
  $("#bubble-title").textContent = b.title;
  $("#bubble-sub").textContent = `Radius ${b.radius} m · You are ~${Math.round(b.distance_m)} m from center`;
  $("#bubble-expiry").textContent =
    b.remaining_seconds != null
      ? `${Math.floor(b.remaining_seconds / 60)}m ${b.remaining_seconds % 60}s left`
      : "";
  if (typeof b.online_count === "number") setOnline(b.online_count);
  if (!b.active) {
    setStatus("This bubble has expired.", true);
    $("#chat-input").disabled = true;
  }
}

async function loadHistory() {
  const res = await fetch(`/api/bubbles/${bubbleId}/messages/?limit=80`, { credentials: "include" });
  if (!res.ok) return;
  const data = await res.json();
  $("#messages").innerHTML = "";
  for (const m of data.results || []) appendMessage(m, { scroll: false });
  $("#messages").scrollTop = $("#messages").scrollHeight;
}

function ensureLocation() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      { enableHighAccuracy: true, maximumAge: 20_000, timeout: 12_000 }
    );
  });
}

async function main() {
  await bootstrapSession();
  showWhoami();

  try {
    pos = await ensureLocation();
  } catch {
    setStatus("Location required to join the bubble geofence.", true);
    return;
  }

  await loadBubbleMeta();
  await loadHistory();
  connectWs();

  $("#chat-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const input = $("#chat-input");
    const text = input.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "chat",
        message: text,
        latitude: pos.lat,
        longitude: pos.lng,
      })
    );
    input.value = "";
    ws.send(JSON.stringify({ type: "typing", typing: false, latitude: pos.lat, longitude: pos.lng }));
  });

  $("#chat-input").addEventListener("input", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - lastTypingSent > 2500) {
      ws.send(JSON.stringify({ type: "typing", typing: true, latitude: pos.lat, longitude: pos.lng }));
      lastTypingSent = now;
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "typing", typing: false, latitude: pos.lat, longitude: pos.lng }));
      }
    }, 1600);
  });
}

main();
