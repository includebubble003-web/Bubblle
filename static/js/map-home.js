/**
 * Map-first landing: onboarding, markers, bottom sheets.
 */
import {
  formatGeolocationError,
  geolocationPermissionState,
  requestLocationOnce,
} from "./geo.js";

let map = null;
let userMarker = null;
let markersLayer = null;
const markerById = new Map();
let selectedBubble = null;
let hooks = {};

function $(sel) {
  return document.querySelector(sel);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtDistance(m) {
  const n = Number(m);
  if (!Number.isFinite(n)) return "";
  if (n < 1000) return `${Math.round(n)} m`;
  return `${(n / 1000).toFixed(1)} km`;
}

function fmtRemaining(sec) {
  if (sec <= 0) return "Ended";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${s}s left`;
  return `${s}s left`;
}

function activeUsers(b) {
  return b.active_users ?? b.online_count ?? 0;
}

function markerSize(count) {
  return Math.min(56, Math.max(36, 32 + count * 4));
}

function isTrending(b, all) {
  const count = activeUsers(b);
  if (count < 2) return false;
  const max = Math.max(...all.map(activeUsers), 0);
  return count >= max && count >= 2;
}

function bubbleIconHtml(b, trending, isNew = false) {
  const count = activeUsers(b);
  const size = markerSize(count);
  const initial = (b.title || "?").trim().charAt(0).toUpperCase() || "?";
  const pulse = trending ? " map-marker-pulse" : "";
  const hot = count >= 3 ? " map-marker-hot" : "";
  const enter = isNew ? " map-marker-enter" : "";
  return `<div class="map-marker${pulse}${hot}${enter}" style="--marker-size:${size}px" data-bubble-id="${escapeHtml(b.id)}">
    <span class="map-marker-ring" aria-hidden="true"></span>
    <span class="map-marker-core">${escapeHtml(initial)}</span>
    <span class="map-marker-count">${count}</span>
  </div>`;
}

function ensureMap() {
  if (map) return map;
  const el = $("#map");
  if (!el || typeof L === "undefined") return null;

  map = L.map(el, {
    zoomControl: false,
    attributionControl: true,
  }).setView([20, 0], 2);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CARTO',
    subdomains: "abcd",
    maxZoom: 20,
  }).addTo(map);

  L.control.zoom({ position: "bottomright" }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  userMarker = L.circleMarker([0, 0], {
    radius: 9,
    color: "#60a5fa",
    fillColor: "#3b82f6",
    fillOpacity: 0.95,
    weight: 3,
  });
  userMarker.addTo(map);

  const youRing = L.circleMarker([0, 0], {
    radius: 18,
    color: "#60a5fa",
    fillColor: "#3b82f6",
    fillOpacity: 0.12,
    weight: 1,
  });
  youRing.addTo(map);
  userMarker._ring = youRing;

  setTimeout(() => map.invalidateSize(), 100);
  return map;
}

export function setMapUserPosition(pos) {
  if (!pos) return;
  ensureMap();
  if (!map || !userMarker) return;
  const latlng = [pos.lat, pos.lng];
  userMarker.setLatLng(latlng);
  if (userMarker._ring) userMarker._ring.setLatLng(latlng);
  if (!map._userCentered) {
    map.setView(latlng, 15, { animate: true });
    map._userCentered = true;
  }
}

export function syncMapMarkers(bubbles) {
  ensureMap();
  if (!map || !markersLayer) return;

  const nextIds = new Set(bubbles.map((b) => b.id));
  for (const [id, marker] of markerById) {
    if (!nextIds.has(id)) {
      markersLayer.removeLayer(marker);
      markerById.delete(id);
    }
  }

  for (const b of bubbles) {
    const trending = isTrending(b, bubbles);
    const isNew = !markerById.has(b.id);
    const icon = L.divIcon({
      className: "map-marker-wrap",
      html: bubbleIconHtml(b, trending, isNew),
      iconSize: [markerSize(activeUsers(b)), markerSize(activeUsers(b)) + 12],
      iconAnchor: [markerSize(activeUsers(b)) / 2, markerSize(activeUsers(b)) / 2 + 6],
    });
    const latlng = [b.latitude, b.longitude];
    let marker = markerById.get(b.id);
    if (marker) {
      marker.setLatLng(latlng);
      marker.setIcon(icon);
    } else {
      marker = L.marker(latlng, { icon }).addTo(markersLayer);
      marker.on("click", () => openBubbleSheet(b));
      markerById.set(b.id, marker);
    }
  }

  updateMapEmptyState(bubbles.length);
  updateLiveBadge(bubbles);
}

function updateLiveBadge(bubbles) {
  const el = $("#map-live-count");
  if (!el) return;
  const textEl = el.querySelector(".live-nearby-text");
  if (!textEl) return;
  const total = bubbles.reduce((s, b) => s + activeUsers(b), 0);
  const chatting = bubbles.filter((b) => activeUsers(b) > 0).length;
  if (chatting > 0) {
    textEl.textContent = `${total} chatting · ${chatting} bubble${chatting === 1 ? "" : "s"} nearby`;
    el.dataset.state = "live";
  } else if (bubbles.length > 0) {
    textEl.textContent = `${bubbles.length} bubble${bubbles.length === 1 ? "" : "s"} nearby`;
    el.dataset.state = "idle";
  } else {
    textEl.textContent = "Live nearby";
    el.dataset.state = "idle";
  }
}

function updateMapEmptyState(count) {
  const card = $("#map-empty");
  const fab = $("#fab-create");
  const hasPos = !!hooks.hasPosition?.();
  if (card) card.hidden = count > 0 || !hasPos;
  fab?.classList.toggle("map-fab--highlight", hasPos && count === 0);
}

function setMapLoading(loading) {
  const el = $("#map-loading");
  if (!el) return;
  el.hidden = !loading;
  $("#map-screen")?.classList.toggle("map-screen--loading", loading);
}

export function showOnboarding(message = "") {
  const el = $("#onboarding");
  if (!el) return;
  el.hidden = false;
  const err = $("#onboarding-error");
  if (err) {
    err.hidden = !message;
    err.textContent = message || "";
  }
  $("#map-screen")?.classList.remove("map-screen--ready");
}

export function hideOnboarding() {
  $("#onboarding")?.setAttribute("hidden", "hidden");
  $("#map-screen")?.classList.add("map-screen--ready");
  ensureMap();
  setTimeout(() => map?.invalidateSize(), 150);
}

async function tryAutoStart() {
  const perm = await geolocationPermissionState();
  if (perm === "granted" || hooks.readCachedPosition?.()) {
    hideOnboarding();
    return true;
  }
  if (perm === "denied") {
    showOnboarding("Location is required to find nearby conversations.");
    return false;
  }
  showOnboarding();
  return false;
}

function openSheet(id) {
  $(id)?.removeAttribute("hidden");
  $("#sheet-backdrop")?.removeAttribute("hidden");
  document.body.classList.add("sheet-open");
}

function closeAllSheets() {
  for (const id of ["#bubble-sheet", "#create-sheet"]) {
    $(id)?.setAttribute("hidden", "hidden");
  }
  $("#sheet-backdrop")?.setAttribute("hidden", "hidden");
  document.body.classList.remove("sheet-open");
  selectedBubble = null;
}

function openBubbleSheet(b) {
  selectedBubble = b;
  const sheet = $("#bubble-sheet");
  if (!sheet) return;
  const count = activeUsers(b);
  const sec = b.remaining_seconds ?? 0;
  $("#sheet-bubble-title").textContent = b.title || "Bubble";
  $("#sheet-bubble-distance").textContent = fmtDistance(b.distance_m);
  $("#sheet-bubble-users").textContent = `${count} active now`;
  $("#sheet-bubble-expiry").textContent = fmtRemaining(sec);
  const joinBtn = $("#sheet-join");
  if (joinBtn) {
    joinBtn.disabled = !b.active;
    joinBtn.textContent = b.active ? "Join conversation" : "Bubble ended";
  }
  const trending = $("#sheet-trending");
  if (trending) trending.hidden = !isTrending(b, hooks.getNearbyBubbles?.() || []);
  openSheet("#bubble-sheet");
}

function openCreateSheet() {
  const input = $("#create-bubble-title");
  if (input) {
    input.value = "";
    setTimeout(() => input.focus(), 200);
  }
  $("#create-sheet-error")?.setAttribute("hidden", "hidden");
  openSheet("#create-sheet");
}

function setupMapUi() {
  $("#btn-enable-location")?.addEventListener("click", async () => {
    const btn = $("#btn-enable-location");
    if (btn) btn.disabled = true;
    try {
      const p = await requestLocationOnce();
      hideOnboarding();
      hooks.onPosition?.(p);
      if (!hooks.hasPosition?.()) hooks.startLocation?.();
    } catch (err) {
      showOnboarding(formatGeolocationError(err));
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("#sheet-backdrop")?.addEventListener("click", closeAllSheets);
  $("#bubble-sheet-close")?.addEventListener("click", closeAllSheets);
  $("#create-sheet-close")?.addEventListener("click", closeAllSheets);

  $("#sheet-join")?.addEventListener("click", () => {
    if (!selectedBubble?.id) return;
    window.location.href = `/bubble/${selectedBubble.id}/`;
  });

  $("#fab-create")?.addEventListener("click", () => {
    if (!hooks.hasPosition?.()) {
      showOnboarding("Enable location to create a bubble where you are.");
      return;
    }
    openCreateSheet();
  });

  $("#map-empty-create")?.addEventListener("click", () => {
    $("#fab-create")?.click();
  });

  $("#create-bubble-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#create-bubble-title")?.value.trim();
    if (!title) return;
    const errEl = $("#create-sheet-error");
    const btn = $("#create-bubble-submit");
    if (btn) btn.disabled = true;
    try {
      if (!hooks.hasPosition?.()) {
        await hooks.ensureLocation?.();
      }
      await hooks.saveName?.();
      const res = await fetch("/api/bubbles/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          latitude: hooks.getPosition().lat,
          longitude: hooks.getPosition().lng,
        }),
      });
      if (!res.ok) {
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = "Could not create bubble. Try again.";
        }
        return;
      }
      const b = await res.json();
      const desc = $("#create-bubble-desc")?.value.trim();
      if (desc) sessionStorage.setItem(`bubble-intro-${b.id}`, desc);
      closeAllSheets();
      window.location.href = `/bubble/${b.id}/`;
    } catch {
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = "Location or network error.";
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllSheets();
  });
}

export function initMapHome(callbacks) {
  hooks = callbacks;
  setupMapUi();
  if (!callbacks.isRoom?.()) {
    ensureMap();
    setMapLoading(!callbacks.hasPosition?.());
    tryAutoStart();
  }
}

export function onMapPositionUpdate(pos) {
  if (!pos) return;
  hideOnboarding();
  setMapLoading(false);
  setMapUserPosition(pos);
}

export function onMapBubblesUpdated(bubbles) {
  syncMapMarkers(bubbles);
}
