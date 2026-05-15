import { bootstrapSession, cachedDisplayName, showWhoami } from "./session.js";

const $ = (sel) => document.querySelector(sel);

let pos = null;

function fmtRemaining(sec) {
  if (sec <= 0) return "Expired";
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m left`;
  if (m > 0) return `${m}m left`;
  return `${sec}s left`;
}

function renderList(rows) {
  const ul = $("#bubble-list");
  const empty = $("#empty-state");
  ul.innerHTML = "";
  if (!rows.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  for (const b of rows) {
    const li = document.createElement("li");
    li.className = "bubble-card";
    li.innerHTML = `
      <a class="bubble-card-link" href="/bubble/${b.id}/">
        <div class="bubble-card-title">${escapeHtml(b.title)}</div>
        <div class="bubble-card-meta">
          <span>${Math.round(b.distance_m)} m</span>
          <span>·</span>
          <span>${b.online_count ?? 0} here</span>
          <span>·</span>
          <span>${fmtRemaining(b.remaining_seconds)}</span>
        </div>
      </a>`;
    ul.appendChild(li);
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
    search_radius_m: "15000",
  });
  const res = await fetch(`/api/bubbles/nearby/?${params}`, { credentials: "include" });
  if (!res.ok) {
    $("#empty-state").textContent = "Could not load bubbles.";
    return;
  }
  const data = await res.json();
  renderList(data.results || []);
}

function setLocBanner(text, kind = "warn") {
  const b = $("#loc-banner");
  b.hidden = !text;
  b.textContent = text || "";
  b.className = `banner banner-${kind}`;
}

async function ensureLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(e),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 }
    );
  });
}

async function main() {
  try {
    await bootstrapSession();
  } catch {
    setLocBanner("Could not start session. Check network and try again.", "bad");
    return;
  }
  showWhoami();

  $("#btn-locate").addEventListener("click", async () => {
    setLocBanner("Locating…", "info");
    try {
      pos = await ensureLocation();
      $("#f-lat").value = String(pos.lat);
      $("#f-lng").value = String(pos.lng);
      $("#btn-create").disabled = false;
      setLocBanner(`Using ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`, "ok");
      await refreshNearby();
    } catch {
      setLocBanner("Location denied or unavailable. Allow location to use Bubblle.", "bad");
    }
  });

  $("#btn-refresh").addEventListener("click", () => refreshNearby());

  $("#create-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!pos) {
      setLocBanner("Set location first.", "warn");
      return;
    }
    const fd = new FormData(ev.target);
    const body = {
      title: fd.get("title"),
      latitude: pos.lat,
      longitude: pos.lng,
      radius: Number(fd.get("radius")),
      expires_in_seconds: Number(fd.get("expires_in_seconds")),
    };
    const btn = $("#btn-create");
    btn.disabled = true;
    try {
      const res = await fetch("/api/bubbles/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLocBanner(err.detail || "Create failed", "bad");
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

  // Friendly default label before /me resolves race
  if (cachedDisplayName() && cachedDisplayName() !== "…") showWhoami();
}

main();
