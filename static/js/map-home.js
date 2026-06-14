/**
 * Split-screen landing: compact discovery map + scrollable bubble feed.
 */
import {
  activeUsers,
  bubbleFingerprint,
  markerFingerprint,
  syncOrderedList,
} from "./bubble-sync.js";
import {
  INTEREST_OPTIONS,
  MAX_INTERESTS,
  canShowRecommendations,
  getUserInterests,
  hasInterestProfile,
  markInterestsSkipped,
  rankRecommendedBubbles,
  saveUserInterests,
} from "./interests.js";
import {
  formatGeolocationError,
  geolocationPermissionState,
  requestLocationOnce,
} from "./geo.js";
import { safeGetItem, safeSetItem } from "./client-state.js";

let map = null;
let userMarker = null;
let markersLayer = null;
const markerById = new Map();
const bubbleById = new Map();
let hooks = {};
let feedLoading = false;
let feedLoadedOnce = false;
let selectedBubbleId = null;
let mapMoveTimer = null;
let suppressMapMoveRefresh = false;
const markerStateById = new Map();
let similarSearchTimer = null;
let similarFetchAbort = null;
const SIMILAR_SEARCH_MS = 320;
const SIMILAR_SEARCH_RADIUS_M = 5000;

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

function bubbleInitial(title) {
  const t = String(title || "?").trim();
  return t ? t.charAt(0).toUpperCase() : "?";
}

function fmtLastActivity(b) {
  const count = activeUsers(b);
  if (count > 0) return "Active now";
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
  const trending = isTrending(b, bubbles);
  const selected = selectedBubbleId === b.id;
  const fp = markerFingerprint(b, { trending, selected });
  if (markerStateById.get(b.id) === fp) return;

  const size = markerSize(activeUsers(b));
  const icon = L.divIcon({
    className: "map-marker-wrap",
    html: bubbleIconHtml(b, { trending, selected }),
    iconSize: [size, size + 10],
    iconAnchor: [size / 2, size / 2 + 5],
  });
  marker.setIcon(icon);
  markerStateById.set(b.id, fp);
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
      markerStateById.delete(id);
    }
  }

  for (const b of bubbles) {
    const isNew = !markerById.has(b.id);
    const trending = isTrending(b, bubbles);
    const selected = selectedBubbleId === b.id;
    const fp = markerFingerprint(b, { trending, selected });
    const latlng = [b.latitude, b.longitude];
    let marker = markerById.get(b.id);

    if (marker) {
      marker.setLatLng(latlng);
      if (markerStateById.get(b.id) !== fp) {
        const size = markerSize(activeUsers(b));
        const icon = L.divIcon({
          className: "map-marker-wrap",
          html: bubbleIconHtml(b, { trending, isNew: false, selected }),
          iconSize: [size, size + 10],
          iconAnchor: [size / 2, size / 2 + 5],
        });
        marker.setIcon(icon);
        markerStateById.set(b.id, fp);
      }
    } else {
      const size = markerSize(activeUsers(b));
      const icon = L.divIcon({
        className: "map-marker-wrap",
        html: bubbleIconHtml(b, { trending, isNew, selected }),
        iconSize: [size, size + 10],
        iconAnchor: [size / 2, size / 2 + 5],
      });
      marker = L.marker(latlng, { icon }).addTo(markersLayer);
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        selectBubble(b.id, { scroll: true, pan: true });
      });
      markerById.set(b.id, marker);
      markerStateById.set(b.id, fp);
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

function bubbleCardHtml(b, { compact = false, recommended = false } = {}) {
  const count = activeUsers(b);
  const live = count > 0;
  const trending = isTrending(b, hooks.getNearbyBubbles?.() || []);
  const selected = selectedBubbleId === b.id;
  const cls = [
    "bubble-card",
    compact ? "bubble-card--compact" : "",
    live ? "bubble-card--live" : "",
    trending ? "bubble-card--trending" : "",
    recommended ? "bubble-card--recommended" : "",
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
    ${recommended ? '<span class="bubble-card-badge bubble-card-badge--for-you">For you</span>' : ""}
    ${!recommended && trending ? '<span class="bubble-card-badge">Hot</span>' : ""}
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

function bindFeedCard(el) {
  if (!el || el.dataset.bound === "1") return;
  el.dataset.bound = "1";
  el.addEventListener("click", (e) => {
    if (e.target.closest(".bubble-card-join")) return;
    e.preventDefault();
    if (feedSearchModeActive && isMobileSearchLayout()) {
      completeSearchSelection(el.dataset.bubbleId);
      return;
    }
    selectBubble(el.dataset.bubbleId, { scroll: false, pan: true });
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (feedSearchModeActive && isMobileSearchLayout()) {
        completeSearchSelection(el.dataset.bubbleId);
        return;
      }
      selectBubble(el.dataset.bubbleId, { scroll: false, pan: true });
    }
  });
}

function bindFeedCardEvents(root) {
  root?.querySelectorAll(".bubble-card").forEach((card) => bindFeedCard(card));
}

function createBubbleCardElement(b, { compact = false, recommended = false } = {}) {
  const wrap = document.createElement("div");
  wrap.innerHTML = bubbleCardHtml(b, { compact, recommended });
  const el = wrap.firstElementChild;
  if (el) bindFeedCard(el);
  return el;
}

function applyBubbleCardState(el, b, { compact = false, recommended = false } = {}) {
  const count = activeUsers(b);
  const live = count > 0;
  const trending = isTrending(b, hooks.getNearbyBubbles?.() || []);
  const selected = selectedBubbleId === b.id;

  el.className = [
    "bubble-card",
    compact ? "bubble-card--compact" : "",
    live ? "bubble-card--live" : "",
    trending ? "bubble-card--trending" : "",
    recommended ? "bubble-card--recommended" : "",
    selected ? "bubble-card--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const titleEl = el.querySelector(".bubble-card-title");
  if (titleEl) titleEl.textContent = b.title || "Bubble";

  const stats = el.querySelectorAll(".bubble-card-stat");
  if (stats[0]) stats[0].textContent = `${count} active`;
  if (stats[1]) stats[1].textContent = fmtDistance(b.distance_m);
  if (stats[2]) stats[2].textContent = fmtLastActivity(b);

  let liveDot = el.querySelector(".bubble-card-live-dot");
  if (live && !liveDot) {
    liveDot = document.createElement("span");
    liveDot.className = "bubble-card-live-dot";
    liveDot.setAttribute("aria-hidden", "true");
    el.appendChild(liveDot);
  } else if (!live && liveDot) {
    liveDot.remove();
  }

  let badge = el.querySelector(".bubble-card-badge:not(.bubble-card-badge--for-you)");
  if (!recommended && trending && !badge) {
    badge = document.createElement("span");
    badge.className = "bubble-card-badge";
    badge.textContent = "Hot";
    el.appendChild(badge);
  } else if ((!trending || recommended) && badge) {
    badge.remove();
  }

  let forYou = el.querySelector(".bubble-card-badge--for-you");
  if (recommended && !forYou) {
    forYou = document.createElement("span");
    forYou.className = "bubble-card-badge bubble-card-badge--for-you";
    forYou.textContent = "For you";
    el.appendChild(forYou);
  } else if (!recommended && forYou) {
    forYou.remove();
  }
}

function cardFingerprint(b, allBubbles, { recommended = false } = {}) {
  const max = Math.max(...allBubbles.map(activeUsers), 0);
  const trending = activeUsers(b) >= 2 && activeUsers(b) >= max && max >= 2;
  return `${bubbleFingerprint(b)}|t:${trending ? 1 : 0}|r:${recommended ? 1 : 0}`;
}

function syncFeedSection(container, items, { compact = false, allBubbles = items, recommended = false } = {}) {
  syncOrderedList(container, items, {
    fingerprint: (b) => cardFingerprint(b, allBubbles, { recommended }),
    render: (b) => createBubbleCardElement(b, { compact, recommended }),
    update: (el, b) => applyBubbleCardState(el, b, { compact, recommended }),
    bind: bindFeedCard,
  });
}

function renderFeedSection(sectionId, containerId, items, options = {}) {
  const section = $(sectionId);
  const container = $(containerId);
  if (!container) return;

  if (items.length) {
    section?.removeAttribute("hidden");
    syncFeedSection(container, items, options);
  } else {
    section?.setAttribute("hidden", "hidden");
    container.replaceChildren();
  }
}

let feedSearchQuery = "";
let feedSearchModeActive = false;

const RECENT_SEARCHES_KEY = "bbl_recent_searches";
const MAX_RECENT_SEARCHES = 8;
const MOBILE_SEARCH_MQ = "(max-width: 900px)";

function isMobileSearchLayout() {
  return window.matchMedia(MOBILE_SEARCH_MQ).matches;
}

function getRecentSearches() {
  try {
    const raw = safeGetItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => typeof entry === "string" && entry.trim())
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

function saveRecentSearch(query) {
  const q = query.trim();
  if (!q) return;
  const recent = getRecentSearches().filter((entry) => entry !== q);
  recent.unshift(q);
  safeSetItem(RECENT_SEARCHES_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_SEARCHES)));
}

function hideSearchAuxiliarySections() {
  $("#feed-recent-searches-section")?.setAttribute("hidden", "hidden");
  $("#feed-recent-searches-list")?.replaceChildren();
  $("#feed-search-hint")?.setAttribute("hidden", "hidden");
  $("#feed-search-section")?.setAttribute("hidden", "hidden");
  $("#feed-search-results")?.replaceChildren();
  $("#feed-search-empty")?.setAttribute("hidden", "hidden");
}

function renderRecentSearches() {
  const section = $("#feed-recent-searches-section");
  const list = $("#feed-recent-searches-list");
  const hint = $("#feed-search-hint");
  const recent = getRecentSearches();

  hideSearchAuxiliarySections();

  if (!recent.length) {
    hint?.removeAttribute("hidden");
    return;
  }

  section?.removeAttribute("hidden");
  list?.replaceChildren(
    ...recent.map((query) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "feed-recent-search-item";
      btn.innerHTML = `<svg class="feed-recent-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 8v5l3 2"/><circle cx="12" cy="12" r="9"/></svg><span>${escapeHtml(query)}</span>`;
      btn.addEventListener("click", () => {
        feedSearchQuery = query;
        const input = $("#feed-search");
        if (input) input.value = query;
        renderBubbleFeed(hooks.getNearbyBubbles?.() || []);
      });
      li.appendChild(btn);
      return li;
    }),
  );
}

function setSearchModeUi(active) {
  $("#home-split")?.classList.toggle("home-split--search-mode", active);
  $("#map-screen")?.classList.toggle("home-screen--search-mode", active);
  $("#feed-search-cancel")?.toggleAttribute("hidden", !active);
  const fab = $("#fab-create");
  if (active) fab?.setAttribute("hidden", "hidden");
  else fab?.removeAttribute("hidden");
}

function enterSearchMode() {
  if (!isMobileSearchLayout() || feedSearchModeActive) return;
  feedSearchModeActive = true;
  setSearchModeUi(true);
  $("#home-feed")?.scrollTo({ top: 0 });
  $("#home-feed-scroll")?.scrollTo({ top: 0 });
  renderBubbleFeed(hooks.getNearbyBubbles?.() || []);
}

function exitSearchMode({ clearQuery = false, blurInput = false } = {}) {
  if (!feedSearchModeActive && !clearQuery) return;
  feedSearchModeActive = false;
  setSearchModeUi(false);
  if (clearQuery) {
    feedSearchQuery = "";
    const input = $("#feed-search");
    if (input) input.value = "";
  }
  if (blurInput) $("#feed-search")?.blur();
  renderBubbleFeed(hooks.getNearbyBubbles?.() || []);
  if (map) {
    setTimeout(() => map.invalidateSize(), 360);
  }
}

function completeSearchSelection(bubbleId) {
  saveRecentSearch(feedSearchQuery);
  exitSearchMode({ clearQuery: true });
  window.location.href = bubbleHref(bubbleId);
}

function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .trim();
}

function bubbleMatchesSearch(bubble, query) {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const haystack = normalizeSearchText(bubble.title);
  return haystack.includes(q);
}

function filterBubblesBySearch(bubbles, query) {
  const q = query.trim();
  if (!q) return bubbles;
  return bubbles.filter((b) => bubbleMatchesSearch(b, q));
}

function hideStandardFeedSections() {
  $("#feed-recommended-section")?.setAttribute("hidden", "hidden");
  $("#feed-nearby-section")?.setAttribute("hidden", "hidden");
  $("#feed-trending-section")?.setAttribute("hidden", "hidden");
  $("#feed-recent-section")?.setAttribute("hidden", "hidden");
  $("#feed-discover-section")?.setAttribute("hidden", "hidden");
  $("#feed-recommended")?.replaceChildren();
  $("#feed-nearby")?.replaceChildren();
  $("#feed-trending")?.replaceChildren();
  $("#feed-recent")?.replaceChildren();
  $("#feed-discover")?.replaceChildren();
}

function renderStandardFeedSections(bubbles) {
  const interests = getUserInterests();
  const recommended = canShowRecommendations()
    ? rankRecommendedBubbles(bubbles, interests, 8)
    : [];
  const nearbyCommunities = sortByDistance(bubbles).slice(0, 8);
  const trending = sortByActivity(bubbles.filter((b) => activeUsers(b) >= 2)).slice(0, 8);
  const trendingIds = new Set(trending.map((b) => b.id));
  const recent = sortByActivity(
    bubbles.filter((b) => activeUsers(b) > 0 && !trendingIds.has(b.id)),
  ).slice(0, 8);

  const featuredIds = new Set([
    ...recommended.map((b) => b.id),
    ...nearbyCommunities.map((b) => b.id),
    ...trending.map((b) => b.id),
    ...recent.map((b) => b.id),
  ]);
  const discover = sortByDistance(bubbles.filter((b) => !featuredIds.has(b.id)));

  const countEl = $("#feed-nearby-count");
  if (countEl) {
    countEl.textContent = nearbyCommunities.length
      ? `${bubbles.length} in this area`
      : "";
  }

  renderFeedSection("#feed-recommended-section", "#feed-recommended", recommended, {
    allBubbles: bubbles,
    recommended: true,
  });
  renderFeedSection("#feed-nearby-section", "#feed-nearby", nearbyCommunities, {
    allBubbles: bubbles,
  });
  renderFeedSection("#feed-trending-section", "#feed-trending", trending, {
    compact: true,
    allBubbles: bubbles,
  });
  renderFeedSection("#feed-recent-section", "#feed-recent", recent, {
    allBubbles: bubbles,
  });
  renderFeedSection("#feed-discover-section", "#feed-discover", discover, {
    allBubbles: bubbles,
  });
}

function renderSearchFeed(bubbles, query) {
  const searchSection = $("#feed-search-section");
  const searchResults = $("#feed-search-results");
  const searchEmpty = $("#feed-search-empty");
  const searchCount = $("#feed-search-count");
  const results = sortByDistance(filterBubblesBySearch(bubbles, query));

  hideStandardFeedSections();
  $("#feed-recent-searches-section")?.setAttribute("hidden", "hidden");
  $("#feed-recent-searches-list")?.replaceChildren();
  $("#feed-search-hint")?.setAttribute("hidden", "hidden");
  $("#home-empty")?.setAttribute("hidden", "hidden");
  $("#home-feed")?.classList.remove("home-feed--empty");
  document.querySelector(".home-legal-footer")?.toggleAttribute("hidden", feedSearchModeActive);

  if (!results.length) {
    searchSection?.setAttribute("hidden", "hidden");
    searchResults?.replaceChildren();
    searchEmpty?.removeAttribute("hidden");
    if (searchCount) searchCount.textContent = "";
    return;
  }

  searchEmpty?.setAttribute("hidden", "hidden");
  searchSection?.removeAttribute("hidden");
  if (searchCount) {
    searchCount.textContent = `${results.length} match${results.length === 1 ? "" : "es"}`;
  }
  syncFeedSection(searchResults, results, { allBubbles: bubbles });
}

function renderSearchModeFeed(bubbles, query) {
  hideStandardFeedSections();
  $("#home-empty")?.setAttribute("hidden", "hidden");
  $("#home-feed")?.classList.remove("home-feed--empty");
  document.querySelector(".home-legal-footer")?.setAttribute("hidden", "hidden");

  if (query.length > 0) {
    renderSearchFeed(bubbles, query);
    return;
  }

  hideSearchAuxiliarySections();
  renderRecentSearches();
}

function renderBubbleFeed(bubbles) {
  const hasPos = !!hooks.hasPosition?.();
  const emptyEl = $("#home-empty");
  const feedEl = $("#home-feed");
  const feedScroll = $("#home-feed-scroll");
  const query = feedSearchQuery.trim();
  const inSearchMode = feedSearchModeActive && isMobileSearchLayout();
  const isFiltering = query.length > 0;

  const scrollTop = inSearchMode ? (feedEl?.scrollTop ?? 0) : (feedScroll?.scrollTop ?? 0);

  setFeedLoading(false);
  feedLoadedOnce = true;

  if (!hasPos) {
    hideStandardFeedSections();
    hideSearchAuxiliarySections();
    emptyEl?.setAttribute("hidden", "hidden");
    return;
  }

  if (inSearchMode) {
    renderSearchModeFeed(bubbles, query);
  } else if (isFiltering) {
    hideSearchAuxiliarySections();
    document.querySelector(".home-legal-footer")?.removeAttribute("hidden");
    renderSearchFeed(bubbles, query);
  } else {
    hideSearchAuxiliarySections();
    document.querySelector(".home-legal-footer")?.removeAttribute("hidden");
    renderStandardFeedSections(bubbles);

    const showEmpty = bubbles.length === 0;
    if (emptyEl) emptyEl.hidden = !showEmpty;
    feedEl?.classList.toggle("home-feed--empty", showEmpty);

    const fab = $("#fab-create");
    fab?.classList.toggle("home-fab--highlight", showEmpty && hasPos);
  }

  if (selectedBubbleId) {
    document.querySelectorAll(".bubble-card").forEach((el) => {
      el.classList.toggle("bubble-card--selected", el.dataset.bubbleId === selectedBubbleId);
    });
  }

  if (inSearchMode) {
    if (feedEl && feedEl.scrollTop !== scrollTop) feedEl.scrollTop = scrollTop;
  } else if (feedScroll && feedScroll.scrollTop !== scrollTop) {
    feedScroll.scrollTop = scrollTop;
  }
}

export function setHomeFeedLoading(loading) {
  if (loading && feedLoadedOnce) return;
  setFeedLoading(loading);
}

function setFeedLoading(loading) {
  feedLoading = loading;
  $("#feed-loading")?.toggleAttribute("hidden", !loading);
  if (loading && !feedLoadedOnce) {
    $("#feed-recommended-section")?.setAttribute("hidden", "hidden");
    $("#feed-nearby-section")?.setAttribute("hidden", "hidden");
    $("#feed-trending-section")?.setAttribute("hidden", "hidden");
    $("#feed-recent-section")?.setAttribute("hidden", "hidden");
    $("#feed-discover-section")?.setAttribute("hidden", "hidden");
    $("#feed-search-section")?.setAttribute("hidden", "hidden");
    $("#feed-search-empty")?.setAttribute("hidden", "hidden");
    $("#feed-recent-searches-section")?.setAttribute("hidden", "hidden");
    $("#feed-search-hint")?.setAttribute("hidden", "hidden");
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
  if (loading && !feedLoading && !feedLoadedOnce) setFeedLoading(true);
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
  clearSimilarResults();
}

function clearSimilarResults() {
  if (similarSearchTimer) {
    clearTimeout(similarSearchTimer);
    similarSearchTimer = null;
  }
  if (similarFetchAbort) {
    similarFetchAbort.abort();
    similarFetchAbort = null;
  }
  const section = $("#create-similar-section");
  const list = $("#create-similar-list");
  section?.setAttribute("hidden", "hidden");
  if (list) list.replaceChildren();
  updateCreateSubmitLabel(false);
}

function updateCreateSubmitLabel(hasSimilar) {
  const btn = $("#create-bubble-submit");
  if (!btn) return;
  if (hasSimilar) {
    btn.textContent = "Create new bubble anyway";
    btn.classList.add("btn-sheet-primary--secondary-label");
  } else {
    btn.textContent = "Create & join";
    btn.classList.remove("btn-sheet-primary--secondary-label");
  }
}

function renderSimilarResults(bubbles) {
  const section = $("#create-similar-section");
  const list = $("#create-similar-list");
  if (!section || !list) return;

  if (!bubbles.length) {
    section.setAttribute("hidden", "hidden");
    list.replaceChildren();
    updateCreateSubmitLabel(false);
    return;
  }

  section.removeAttribute("hidden");
  list.replaceChildren(
    ...bubbles.map((b) => {
      const li = document.createElement("li");
      li.className = "create-similar-item";
      const count = activeUsers(b);
      li.innerHTML = `<span class="create-similar-item-body">
        <span class="create-similar-item-title">${escapeHtml(b.title || "Bubble")}</span>
        <span class="create-similar-item-meta">${count} active nearby</span>
      </span>
      <a href="${bubbleHref(b.id)}" class="create-similar-join">Join</a>`;
      return li;
    })
  );
  updateCreateSubmitLabel(true);
}

function scheduleSimilarSearch(query) {
  if (similarSearchTimer) clearTimeout(similarSearchTimer);
  const trimmed = query.trim();

  if (trimmed.length < 2) {
    clearSimilarResults();
    return;
  }

  similarSearchTimer = setTimeout(() => {
    similarSearchTimer = null;
    searchSimilarBubbles(trimmed);
  }, SIMILAR_SEARCH_MS);
}

async function searchSimilarBubbles(query) {
  const pos = hooks.getPosition?.();
  if (!pos) {
    clearSimilarResults();
    return;
  }

  if (similarFetchAbort) similarFetchAbort.abort();
  similarFetchAbort = new AbortController();

  const section = $("#create-similar-section");
  const list = $("#create-similar-list");
  section?.removeAttribute("hidden");
  if (list) {
    list.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "create-similar-loading";
    loading.textContent = "Searching similar communities…";
    list.appendChild(loading);
  }

  const params = new URLSearchParams({
    q: query,
    lat: String(pos.lat),
    lng: String(pos.lng),
    search_radius_m: String(SIMILAR_SEARCH_RADIUS_M),
  });

  try {
    const res = await fetch(`/api/bubbles/similar/?${params}`, {
      credentials: "include",
      cache: "no-store",
      signal: similarFetchAbort.signal,
    });
    if (!res.ok) {
      renderSimilarResults([]);
      return;
    }
    const data = await res.json();
    renderSimilarResults(data.results || []);
  } catch (err) {
    if (err?.name === "AbortError") return;
    renderSimilarResults([]);
  } finally {
    if (similarFetchAbort?.signal.aborted) return;
    similarFetchAbort = null;
  }
}

function openCreateSheet() {
  const input = $("#create-bubble-title");
  clearSimilarResults();
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

  $("#feed-search")?.addEventListener("focus", () => {
    if (isMobileSearchLayout()) enterSearchMode();
  });

  $("#feed-search")?.addEventListener("input", (e) => {
    feedSearchQuery = e.target.value || "";
    renderBubbleFeed(hooks.getNearbyBubbles?.() || []);
  });

  $("#feed-search-cancel")?.addEventListener("click", () => {
    exitSearchMode({ clearQuery: true, blurInput: true });
  });

  $("#home-feed")?.addEventListener("click", (e) => {
    const join = e.target.closest(".bubble-card-join");
    if (!join || !feedSearchModeActive || !isMobileSearchLayout()) return;
    saveRecentSearch(feedSearchQuery);
    exitSearchMode({ clearQuery: true });
  });

  window.addEventListener("resize", () => {
    if (feedSearchModeActive && !isMobileSearchLayout()) {
      exitSearchMode({ clearQuery: false });
    }
  });

  $("#feed-search-empty-create")?.addEventListener("click", () => {
    exitSearchMode({ clearQuery: false });
    $("#fab-create")?.click();
  });

  $("#create-bubble-title")?.addEventListener("input", (e) => {
    scheduleSimilarSearch(e.target.value || "");
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
        cache: "no-store",
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

let selectedInterestIds = new Set();

function hideInterestOnboarding() {
  $("#interest-onboarding")?.setAttribute("hidden", "hidden");
}

function showInterestOnboarding() {
  if (hooks.isRoom?.()) return;
  if (hasInterestProfile()) return;
  const overlay = $("#interest-onboarding");
  if (!overlay) return;
  $("#onboarding")?.setAttribute("hidden", "hidden");
  selectedInterestIds = new Set(getUserInterests());
  renderInterestGrid();
  overlay.removeAttribute("hidden");
}

function renderInterestGrid() {
  const grid = $("#interest-grid");
  const countEl = $("#interest-count");
  const continueBtn = $("#btn-interests-continue");
  if (!grid) return;

  grid.replaceChildren(
    ...INTEREST_OPTIONS.map((option) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "interest-chip";
      btn.dataset.interestId = option.id;
      btn.textContent = option.label;
      btn.setAttribute("aria-pressed", selectedInterestIds.has(option.id) ? "true" : "false");
      btn.classList.toggle("interest-chip--selected", selectedInterestIds.has(option.id));
      btn.addEventListener("click", () => toggleInterest(option.id));
      return btn;
    })
  );

  const count = selectedInterestIds.size;
  if (countEl) countEl.textContent = `${count} / ${MAX_INTERESTS} selected`;
  if (continueBtn) continueBtn.disabled = count === 0;
}

function toggleInterest(id) {
  if (selectedInterestIds.has(id)) {
    selectedInterestIds.delete(id);
  } else if (selectedInterestIds.size < MAX_INTERESTS) {
    selectedInterestIds.add(id);
  }
  renderInterestGrid();
}

function finishInterestOnboarding(saved = false) {
  hideInterestOnboarding();
  if (saved) {
    saveUserInterests([...selectedInterestIds]);
    const bubbles = hooks.getNearbyBubbles?.() || [];
    if (bubbles.length) renderBubbleFeed(bubbles);
  }
  hooks.onInterestsComplete?.();
  if (!hooks.hasPosition?.()) tryAutoStart();
}

function setupInterestOnboarding() {
  $("#btn-interests-continue")?.addEventListener("click", () => {
    if (selectedInterestIds.size === 0) return;
    finishInterestOnboarding(true);
  });

  $("#btn-interests-skip")?.addEventListener("click", () => {
    markInterestsSkipped();
    finishInterestOnboarding(false);
  });
}

export function maybeShowInterestOnboarding() {
  if (hooks.isRoom?.()) return;
  if (hasInterestProfile()) return;
  showInterestOnboarding();
}

export function initMapHome(callbacks) {
  hooks = callbacks;
  setupMapUi();
  setupInterestOnboarding();
  if (!callbacks.isRoom?.()) {
    ensureMap();
    setMapLoading(!callbacks.hasPosition?.());
    maybeShowInterestOnboarding();
    if (hasInterestProfile()) tryAutoStart();
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
