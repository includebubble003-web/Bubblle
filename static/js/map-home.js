/**
 * Conversation-first landing: compact map + bubble feed.
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
let hooks = {};
let mapExpanded = false;
let feedLoading = false;

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
  if (!Number.isFinite(n)) return "—";
  if (n < 1000) return `${Math.round(n)} m`;
  return `${(n / 1000).toFixed(1)} km`;
}

function fmtRemaining(sec) {
  if (sec <= 0) return "Ended";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m left`;
  }
  if (m > 0) return `${m}m left`;
  return `${s}s left`;
}

function activeUsers(b) {
  return b.active_users ?? b.online_count ?? 0;
}

function bubbleInitial(title) {
  const t = String(title || "?").trim();
  return t ? t.charAt(0).toUpperCase() : "?";
}

function fmtLastActivity(b) {
  const count = activeUsers(b);
  if (count > 0) return "Active now";
  const sec = b.remaining_seconds ?? 0;
  if (sec > 0 && sec < 900) return "Started recently";
  return "Quiet";
}

function bubbleHref(id) {
  return `/bubble/${id}/`;
}

function isTrending(b, all) {
  const count = activeUsers(b);
  if (count < 2) return false;
  const max = Math.max(...all.map(activeUsers), 0);
  return count >= max && count >= 2;
}

function markerSize(count) {
  return Math.min(48, Math.max(30, 28 + count * 3));
}

function bubbleIconHtml(b, trending, isNew = false) {
  const count = activeUsers(b);
  const size = markerSize(count);
  const initial = bubbleInitial(b.title);
  const pulse = trending ? " map-marker-pulse" : "";
  const hot = count >= 3 ? " map-marker-hot" : "";
  const enter = isNew ? " map-marker-enter" : "";
  return `<div class="map-marker${pulse}${hot}${enter}" style="--marker-size:${size}px" data-bubble-id="${escapeHtml(b.id)}">
    <span class="map-marker-ring" aria-hidden="true"></span>
    <span class="map-marker-core">${escapeHtml(initial)}</span>
    <span class="map-marker-count">${count}</span>
  </div>`;
}

function invalidateMapSoon() {
  if (!map) return;
  requestAnimationFrame(() => {
    map.invalidateSize();
    setTimeout(() => map.invalidateSize(), 250);
  });
}

function ensureMap() {
  if (map) return map;
  const el = $("#map");
  if (!el || typeof L === "undefined") return null;

  map = L.map(el, {
    zoomControl: false,
    attributionControl: true,
    dragging: true,
    scrollWheelZoom: false,
  }).setView([20, 0], 2);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OSM &copy; CARTO',
    subdomains: "abcd",
    maxZoom: 20,
  }).addTo(map);

  L.control.zoom({ position: "bottomright" }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  userMarker = L.circleMarker([0, 0], {
    radius: 8,
    color: "#60a5fa",
    fillColor: "#3b82f6",
    fillOpacity: 0.95,
    weight: 3,
  });
  userMarker.addTo(map);

  const youRing = L.circleMarker([0, 0], {
    radius: 16,
    color: "#60a5fa",
    fillColor: "#3b82f6",
    fillOpacity: 0.12,
    weight: 1,
  });
  youRing.addTo(map);
  userMarker._ring = youRing;

  invalidateMapSoon();
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
    map.setView(latlng, 15, { animate: false });
    map._userCentered = true;
  }
}

function syncMapMarkers(bubbles) {
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
    const size = markerSize(activeUsers(b));
    const icon = L.divIcon({
      className: "map-marker-wrap",
      html: bubbleIconHtml(b, trending, isNew),
      iconSize: [size, size + 10],
      iconAnchor: [size / 2, size / 2 + 5],
    });
    const latlng = [b.latitude, b.longitude];
    let marker = markerById.get(b.id);
    if (marker) {
      marker.setLatLng(latlng);
      marker.setIcon(icon);
    } else {
      marker = L.marker(latlng, { icon }).addTo(markersLayer);
      marker.on("click", () => {
        window.location.href = bubbleHref(b.id);
      });
      markerById.set(b.id, marker);
    }
  }

  updateLiveBadge(bubbles);
}

function bubbleCardHtml(b, { compact = false } = {}) {
  const count = activeUsers(b);
  const live = count > 0;
  const trending = isTrending(b, hooks.getNearbyBubbles?.() || []);
  const cls = [
    "bubble-card",
    compact ? "bubble-card--compact" : "",
    live ? "bubble-card--live" : "",
    trending ? "bubble-card--trending" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<a href="${bubbleHref(b.id)}" class="${cls}" data-bubble-id="${escapeHtml(b.id)}">
    <span class="bubble-card-avatar" aria-hidden="true">${escapeHtml(bubbleInitial(b.title))}</span>
    <span class="bubble-card-body">
      <span class="bubble-card-title">${escapeHtml(b.title || "Bubble")}</span>
      <span class="bubble-card-meta">
        <span class="bubble-card-stat bubble-card-stat--users">${count} active</span>
        <span class="bubble-card-stat">${fmtDistance(b.distance_m)}</span>
        <span class="bubble-card-stat bubble-card-stat--activity">${escapeHtml(fmtLastActivity(b))}</span>
      </span>
    </span>
    ${live ? '<span class="bubble-card-live-dot" aria-label="Active now"></span>' : ""}
    ${trending ? '<span class="bubble-card-badge">Hot</span>' : ""}
  </a>`;
}

function sortByDistance(bubbles) {
  return [...bubbles].sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
}

function sortByActivity(bubbles) {
  return [...bubbles].sort((a, b) => {
    const act = activeUsers(b) - activeUsers(a);
    if (act !== 0) return act;
    return (a.distance_m ?? 0) - (b.distance_m ?? 0);
  });
}

function renderBubbleFeed(bubbles) {
  const hasPos = !!hooks.hasPosition?.();
  const nearbyEl = $("#feed-nearby");
  const recentEl = $("#feed-recent");
  const trendingEl = $("#feed-trending");
  const emptyEl = $("#home-empty");
  const feedEl = $("#home-feed");

  setFeedLoading(false);

  if (!hasPos) {
    $("#feed-trending-section")?.setAttribute("hidden", "hidden");
    $("#feed-recent-section")?.setAttribute("hidden", "hidden");
    $("#feed-nearby-section")?.setAttribute("hidden", "hidden");
    emptyEl?.setAttribute("hidden", "hidden");
    return;
  }

  const nearby = sortByDistance(bubbles);
  const active = sortByActivity(bubbles.filter((b) => activeUsers(b) > 0));
  const trending = sortByActivity(bubbles.filter((b) => activeUsers(b) >= 2)).slice(0, 8);
  const recent = active.filter((b) => !trending.some((t) => t.id === b.id));

  const countEl = $("#feed-nearby-count");
  if (countEl) {
    countEl.textContent = nearby.length ? `${nearby.length} within 5 km` : "";
  }

  if (trendingEl) {
    const section = $("#feed-trending-section");
    if (trending.length) {
      section?.removeAttribute("hidden");
      trendingEl.innerHTML = trending.map((b) => bubbleCardHtml(b, { compact: true })).join("");
    } else {
      section?.setAttribute("hidden", "hidden");
      trendingEl.innerHTML = "";
    }
  }

  if (recentEl) {
    const section = $("#feed-recent-section");
    if (recent.length) {
      section?.removeAttribute("hidden");
      recentEl.innerHTML = recent.map((b) => bubbleCardHtml(b)).join("");
    } else {
      section?.setAttribute("hidden", "hidden");
      recentEl.innerHTML = "";
    }
  }

  if (nearbyEl) {
    const section = $("#feed-nearby-section");
    if (nearby.length) {
      section?.removeAttribute("hidden");
      nearbyEl.innerHTML = nearby.map((b) => bubbleCardHtml(b)).join("");
    } else {
      section?.setAttribute("hidden", "hidden");
      nearbyEl.innerHTML = "";
    }
  }

  const showEmpty = nearby.length === 0;
  if (emptyEl) emptyEl.hidden = !showEmpty;
  feedEl?.classList.toggle("home-feed--empty", showEmpty);

  const fab = $("#fab-create");
  fab?.classList.toggle("home-fab--highlight", showEmpty && hasPos);
}

export function setHomeFeedLoading(loading) {
  setFeedLoading(loading);
}

function setFeedLoading(loading) {
  feedLoading = loading;
  $("#feed-loading")?.toggleAttribute("hidden", !loading);
  if (loading) {
    $("#feed-trending-section")?.setAttribute("hidden", "hidden");
    $("#feed-recent-section")?.setAttribute("hidden", "hidden");
    $("#feed-nearby-section")?.setAttribute("hidden", "hidden");
    $("#home-empty")?.setAttribute("hidden", "hidden");
  }
}

function updateLiveBadge(bubbles) {
  const el = $("#map-live-count");
  if (!el) return;
  const textEl = el.querySelector(".live-nearby-text");
  if (!textEl) return;
  const total = bubbles.reduce((s, b) => s + activeUsers(b), 0);
  const chatting = bubbles.filter((b) => activeUsers(b) > 0).length;
  if (chatting > 0) {
    textEl.textContent = `${total} chatting nearby`;
    el.dataset.state = "live";
  } else if (bubbles.length > 0) {
    textEl.textContent = `${bubbles.length} bubble${bubbles.length === 1 ? "" : "s"} nearby`;
    el.dataset.state = "idle";
  } else {
    textEl.textContent = "Live nearby";
    el.dataset.state = "idle";
  }
}

function setMapLoading(loading) {
  const el = $("#map-loading");
  if (el) el.hidden = !loading;
  $("#map-screen")?.classList.toggle("home-screen--loading", loading);
  if (loading && !feedLoading) setFeedLoading(true);
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
  $("#map-screen")?.classList.remove("home-screen--ready");
}

export function hideOnboarding() {
  $("#onboarding")?.setAttribute("hidden", "hidden");
  $("#map-screen")?.classList.add("home-screen--ready");
  ensureMap();
  invalidateMapSoon();
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
  $("#create-sheet")?.setAttribute("hidden", "hidden");
  $("#sheet-backdrop")?.setAttribute("hidden", "hidden");
  document.body.classList.remove("sheet-open");
}

function openCreateSheet() {
  const input = $("#create-bubble-title");
  if (input) {
    input.value = "";
    $("#create-bubble-desc").value = "";
    setTimeout(() => input.focus(), 200);
  }
  $("#create-sheet-error")?.setAttribute("hidden", "hidden");
  openSheet("#create-sheet");
}

function setMapExpanded(expanded) {
  mapExpanded = expanded;
  const wrap = $("#home-map-wrap");
  wrap?.classList.toggle("home-map-wrap--expanded", expanded);
  document.body.classList.toggle("map-expanded", expanded);
  $("#btn-map-expand")?.toggleAttribute("hidden", expanded);
  $("#btn-map-collapse")?.toggleAttribute("hidden", !expanded);
  invalidateMapSoon();
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

  $("#btn-map-expand")?.addEventListener("click", () => setMapExpanded(true));
  $("#btn-map-collapse")?.addEventListener("click", () => setMapExpanded(false));

  $("#home-map-wrap")?.addEventListener("click", (e) => {
    if (mapExpanded) return;
    if (e.target.closest(".map-expand-btn, .map-collapse-btn, .leaflet-control")) return;
    if (e.target.closest(".leaflet-marker-icon, .map-marker-wrap")) return;
    setMapExpanded(true);
  });

  $("#sheet-backdrop")?.addEventListener("click", closeAllSheets);
  $("#create-sheet-close")?.addEventListener("click", closeAllSheets);

  $("#fab-create")?.addEventListener("click", () => {
    if (!hooks.hasPosition?.()) {
      showOnboarding("Enable location to create a bubble where you are.");
      return;
    }
    openCreateSheet();
  });

  $("#home-empty-create")?.addEventListener("click", () => {
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
      window.location.href = bubbleHref(b.id);
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
    if (e.key === "Escape") {
      if (mapExpanded) setMapExpanded(false);
      else closeAllSheets();
    }
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
  renderBubbleFeed(bubbles);
}
