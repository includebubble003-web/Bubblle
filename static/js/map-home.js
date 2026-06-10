/**
 * Split-screen landing: compact discovery map + scrollable bubble feed.
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
const bubbleById = new Map();
let hooks = {};
let feedLoading = false;
let selectedBubbleId = null;
let mapMoveTimer = null;
let suppressMapMoveRefresh = false;

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
  return Math.min(44, Math.max(28, 26 + count * 3));
}

function bubbleIconHtml(b, { trending = false, isNew = false, selected = false } = {}) {
  const count = activeUsers(b);
  const size = markerSize(count);
  const initial = bubbleInitial(b.title);
  const pulse = trending ? " map-marker-pulse" : "";
  const hot = count >= 3 ? " map-marker-hot" : "";
  const enter = isNew ? " map-marker-enter" : "";
  const sel = selected ? " map-marker-selected" : "";
  return `<div class="map-marker${pulse}${hot}${enter}${sel}" style="--marker-size:${size}px" data-bubble-id="${escapeHtml(b.id)}">
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

function getMapCenter() {
  if (!map) return null;
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng };
}

function scheduleDiscoveryRefresh() {
  if (suppressMapMoveRefresh) return;
  if (mapMoveTimer) clearTimeout(mapMoveTimer);
  mapMoveTimer = setTimeout(() => {
    const center = getMapCenter();
    if (center) hooks.onDiscoveryCenterChange?.(center);
  }, 450);
}

function ensureMap() {
  if (map) return map;
  const el = $("#map");
  if (!el || typeof L === "undefined") return null;

  map = L.map(el, {
    zoomControl: false,
    attributionControl: false,
    dragging: true,
    scrollWheelZoom: true,
    touchZoom: true,
    doubleClickZoom: true,
  }).setView([20, 0], 2);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "",
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

  map.on("moveend", scheduleDiscoveryRefresh);

  invalidateMapSoon();
  return map;
}

export function getDiscoveryCenter() {
  return getMapCenter() || hooks.getPosition?.() || null;
}

export function setMapUserPosition(pos) {
  if (!pos) return;
  ensureMap();
  if (!map || !userMarker) return;
  const latlng = [pos.lat, pos.lng];
  userMarker.setLatLng(latlng);
  if (userMarker._ring) userMarker._ring.setLatLng(latlng);
  $("#btn-map-recenter")?.removeAttribute("hidden");
  if (!map._userCentered) {
    suppressMapMoveRefresh = true;
    map.setView(latlng, 15, { animate: false });
    map._userCentered = true;
    setTimeout(() => {
      suppressMapMoveRefresh = false;
      hooks.onDiscoveryCenterChange?.({ lat: pos.lat, lng: pos.lng });
    }, 100);
  }
}

function recenterOnUser() {
  const pos = hooks.getPosition?.();
  if (!pos || !map) return;
  suppressMapMoveRefresh = true;
  map.setView([pos.lat, pos.lng], map.getZoom(), { animate: true });
  setTimeout(() => {
    suppressMapMoveRefresh = false;
    hooks.onDiscoveryCenterChange?.({ lat: pos.lat, lng: pos.lng });
  }, 350);
}

function updateMarkerIcon(b, bubbles) {
  const marker = markerById.get(b.id);
  if (!marker) return;
  const size = markerSize(activeUsers(b));
  const icon = L.divIcon({
    className: "map-marker-wrap",
    html: bubbleIconHtml(b, {
      trending: isTrending(b, bubbles),
      selected: selectedBubbleId === b.id,
    }),
    iconSize: [size, size + 10],
    iconAnchor: [size / 2, size / 2 + 5],
  });
  marker.setIcon(icon);
}

function syncMapMarkers(bubbles) {
  ensureMap();
  if (!map || !markersLayer) return;

  bubbleById.clear();
  for (const b of bubbles) bubbleById.set(b.id, b);

  const nextIds = new Set(bubbles.map((b) => b.id));
  for (const [id, marker] of markerById) {
    if (!nextIds.has(id)) {
      markersLayer.removeLayer(marker);
      markerById.delete(id);
    }
  }

  for (const b of bubbles) {
    const isNew = !markerById.has(b.id);
    const size = markerSize(activeUsers(b));
    const icon = L.divIcon({
      className: "map-marker-wrap",
      html: bubbleIconHtml(b, {
        trending: isTrending(b, bubbles),
        isNew,
        selected: selectedBubbleId === b.id,
      }),
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
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        selectBubble(b.id, { scroll: true, pan: true });
      });
      markerById.set(b.id, marker);
    }
  }

  if (selectedBubbleId && !nextIds.has(selectedBubbleId)) {
    selectBubble(null);
  }

  updateLiveBadge(bubbles);
}

export function selectBubble(id, { scroll = false, pan = false } = {}) {
  selectedBubbleId = id || null;

  document.querySelectorAll(".bubble-card").forEach((el) => {
    el.classList.toggle("bubble-card--selected", el.dataset.bubbleId === selectedBubbleId);
  });

  const bubbles = hooks.getNearbyBubbles?.() || [];
  for (const b of bubbles) updateMarkerIcon(b, bubbles);

  if (!selectedBubbleId) return;

  if (scroll) {
    const card = document.querySelector(`.bubble-card[data-bubble-id="${selectedBubbleId}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  if (pan && map) {
    const b = bubbleById.get(selectedBubbleId);
    if (b) {
      suppressMapMoveRefresh = true;
      map.panTo([b.latitude, b.longitude], { animate: true, duration: 0.35 });
      setTimeout(() => {
        suppressMapMoveRefresh = false;
      }, 400);
    }
  }
}

function bubbleCardHtml(b, { compact = false } = {}) {
  const count = activeUsers(b);
  const live = count > 0;
  const trending = isTrending(b, hooks.getNearbyBubbles?.() || []);
  const selected = selectedBubbleId === b.id;
  const cls = [
    "bubble-card",
    compact ? "bubble-card--compact" : "",
    live ? "bubble-card--live" : "",
    trending ? "bubble-card--trending" : "",
    selected ? "bubble-card--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const joinBtn = compact
    ? `<a href="${bubbleHref(b.id)}" class="bubble-card-join bubble-card-join--sm">Join</a>`
    : `<a href="${bubbleHref(b.id)}" class="bubble-card-join">Join</a>`;

  return `<article class="${cls}" data-bubble-id="${escapeHtml(b.id)}" tabindex="0" role="button" aria-label="${escapeHtml(b.title || "Bubble")}">
    <span class="bubble-card-avatar" aria-hidden="true">${escapeHtml(bubbleInitial(b.title))}</span>
    <span class="bubble-card-body">
      <span class="bubble-card-title">${escapeHtml(b.title || "Bubble")}</span>
      <span class="bubble-card-meta">
        <span class="bubble-card-stat bubble-card-stat--users">${count} active</span>
        <span class="bubble-card-stat">${fmtDistance(b.distance_m)}</span>
        <span class="bubble-card-stat bubble-card-stat--activity">${escapeHtml(fmtLastActivity(b))}</span>
      </span>
    </span>
    ${live ? '<span class="bubble-card-live-dot" aria-hidden="true"></span>' : ""}
    ${trending ? '<span class="bubble-card-badge">Hot</span>' : ""}
    ${joinBtn}
  </article>`;
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

function bindFeedCardEvents(root) {
  root?.querySelectorAll(".bubble-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".bubble-card-join")) return;
      e.preventDefault();
      selectBubble(card.dataset.bubbleId, { scroll: false, pan: true });
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectBubble(card.dataset.bubbleId, { scroll: false, pan: true });
      }
    });
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
    countEl.textContent = nearby.length ? `${nearby.length} in this area` : "";
  }

  if (trendingEl) {
    const section = $("#feed-trending-section");
    if (trending.length) {
      section?.removeAttribute("hidden");
      trendingEl.innerHTML = trending.map((b) => bubbleCardHtml(b, { compact: true })).join("");
      bindFeedCardEvents(trendingEl);
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
      bindFeedCardEvents(recentEl);
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
      bindFeedCardEvents(nearbyEl);
    } else {
      section?.setAttribute("hidden", "hidden");
      nearbyEl.innerHTML = "";
    }
  }

  if (selectedBubbleId) {
    document.querySelectorAll(".bubble-card").forEach((el) => {
      el.classList.toggle("bubble-card--selected", el.dataset.bubbleId === selectedBubbleId);
    });
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
    const desc = $("#create-bubble-desc");
    if (desc) desc.value = "";
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

  $("#btn-map-recenter")?.addEventListener("click", (e) => {
    e.stopPropagation();
    recenterOnUser();
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
  renderBubbleFeed(bubbles);
}
