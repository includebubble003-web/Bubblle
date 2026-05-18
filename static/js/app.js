import {
  bootstrapSession,
  showWhoami,
  updateDisplayName,
} from "./session.js";
import {
  acquireLocation,
  formatGeolocationError,
  geolocationPermissionState,
  isGeolocationContextOk,
  secureContextHint,
} from "./geo.js";

const $ = (sel) => document.querySelector(sel);

const SEARCH_RADIUS_M = 5000;
const NEARBY_POLL_MS = 5000;

let pos = null;
let nearbyPollTimer = null;
let stopLocation = null;

function fmtRemaining(sec) {
  if (sec <= 0) return "Expired";
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m left`;
  if (m > 0) return `${m}m left`;
  return `${sec}s left`;
}

function activeUsers(b) {
  return b.active_users ?? b.online_count ?? 0;
}

function renderList(rows) {
  const ul = $("#bubble-list");
  const empty = $("#empty-state");
  ul.innerHTML = "";
  if (!rows.length) {
    empty.hidden = false;
    empty.textContent = pos
      ? "No bubbles within 5 km. Create one above."
      : "Allow location to see nearby bubbles.";
    return;
  }
  empty.hidden = true;
  for (const b of rows) {
    const n = activeUsers(b);
    const li = document.createElement("li");
    li.className = "bubble-card";
    li.dataset.bubbleId = b.id;
    li.innerHTML = `
      <a class="bubble-card-link" href="/bubble/${b.id}/">
        <div class="bubble-card-head">
          <span class="bubble-card-title">${escapeHtml(b.title)}</span>
          <span class="bubble-card-active">${n} active</span>
        </div>
        <div class="bubble-card-meta">
          <span>${Math.round(b.distance_m)} m away</span>
          <span>·</span>
          <span>${fmtRemaining(b.remaining_seconds)}</span>
        </div>
      </a>`;
    ul.appendChild(li);
  }
}

function startNearbyPolling() {
  stopNearbyPolling();
  nearbyPollTimer = setInterval(() => {
    if (pos && document.visibilityState !== "hidden") refreshNearby();
  }, NEARBY_POLL_MS);
}

function stopNearbyPolling() {
  if (nearbyPollTimer) {
    clearInterval(nearbyPollTimer);
    nearbyPollTimer = null;
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function refreshNearby() {
  if (!pos) return;
  const params = new URLSearchParams({
    lat: String(pos.lat),
    lng: String(pos.lng),
    search_radius_m: String(SEARCH_RADIUS_M),
  });
  const res = await fetch(`/api/bubbles/nearby/?${params}`, { credentials: "include" });
  if (!res.ok) {
    $("#empty-state").hidden = false;
    $("#empty-state").textContent = "Could not load bubbles.";
    return;
  }
  const data = await res.json();
  renderList(data.results || []);
}

function setLocBanner(text, kind = "warn") {
  const b = $("#loc-banner");
  if (!b) return;
  b.hidden = !text;
  b.textContent = text || "";
  b.className = `banner banner-${kind}`;
}

function setNameStatus(text, ok = true) {
  const el = $("#name-status");
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || "";
  el.className = ok ? "muted fine-print" : "muted fine-print name-error";
}

function applyPosition(p, { quiet = false } = {}) {
  pos = p;
  $("#f-lat").value = String(p.lat);
  $("#f-lng").value = String(p.lng);
  $("#btn-create").disabled = false;
  if (!quiet) setLocBanner("", false);
  refreshNearby();
  startNearbyPolling();
}

function startLocation() {
  if (!isGeolocationContextOk()) {
    setLocBanner(secureContextHint(), "bad");
    return;
  }

  geolocationPermissionState().then((perm) => {
    if (perm === "granted") {
      setLocBanner("Detecting your location…", "info");
    } else {
      setLocBanner("Allow location when your browser asks — required for nearby bubbles.", "info");
    }
  });

  if (stopLocation) stopLocation();
  stopLocation = acquireLocation({
    onUpdate: (p, meta) => {
      const quiet = meta.source === "refined";
      applyPosition(p, { quiet });
      if (meta.source === "cached" || meta.source === "fast") {
        setLocBanner("", false);
      }
    },
    onError: (err) => {
      if (!pos) {
        setLocBanner(formatGeolocationError(err), "bad");
        $("#empty-state").textContent = "Location is required to use Bubblle.";
      }
    },
    onStatus: (s) => {
      if (s === "prompt") {
        setLocBanner("Tap Allow to share your location.", "info");
      } else if (s === "detecting" && !pos) {
        setLocBanner("Detecting your location…", "info");
      }
    },
  });
}

async function saveDisplayName(name) {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    setNameStatus("Name must be at least 2 characters.", false);
    return false;
  }
  try {
    await updateDisplayName(trimmed);
    showWhoami();
    setNameStatus("Name saved.", true);
    return true;
  } catch (err) {
    setNameStatus(err.message || "Could not save name.", false);
    return false;
  }
}

function main() {
  bootstrapSession()
    .then((session) => {
      const nameInput = $("#display-name");
      if (nameInput && session.anonymous_name) nameInput.value = session.anonymous_name;
      showWhoami();
    })
    .catch(() => setLocBanner("Could not start session. Refresh the page.", "bad"));

  startLocation();

  $("#name-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await saveDisplayName($("#display-name").value);
  });

  $("#btn-refresh").addEventListener("click", () => refreshNearby());
  window.addEventListener("pagehide", () => {
    stopNearbyPolling();
    if (stopLocation) stopLocation();
  });

  $("#create-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!pos) {
      startLocation();
      return;
    }
    const nameOk = await saveDisplayName($("#display-name").value);
    if (!nameOk) return;

    const fd = new FormData(ev.target);
    const btn = $("#btn-create");
    btn.disabled = true;
    try {
      const res = await fetch("/api/bubbles/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: fd.get("title"), latitude: pos.lat, longitude: pos.lng }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLocBanner(err.detail || err.title?.[0] || "Create failed", "bad");
        btn.disabled = false;
        return;
      }
      const bubble = await res.json();
      window.location.href = `/bubble/${bubble.id}/`;
    } catch {
      setLocBanner("Network error creating bubble.", "bad");
      btn.disabled = false;
    }
  });
}

main();
