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
import {
  createQuestionCardElement,
  filterQuestionsBySearch,
  questionCardMeta,
  questionFingerprint,
  questionHref,
} from "./questions.js";

let map = null;
let userMarker = null;
let markersLayer = null;
let questionMarkersLayer = null;
const markerById = new Map();
const questionMarkerById = new Map();
const bubbleById = new Map();
let hooks = {};
let feedLoading = false;
let feedLoadedOnce = false;
let selectedBubbleId = null;
let mapMoveTimer = null;
let suppressMapMoveRefresh = false;
const markerStateById = new Map();
const questionMarkerStateById = new Map();
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

function fmtDistanceAway(m) {
  const d = fmtDistance(m);
  return d === "—" ? d : `${d} away`;
}

function fmtActiveLabel(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "No one active";
  return `${n} active now`;
}

function bubbleCardDetailsHtml(b) {
  const count = activeUsers(b);
  const live = count > 0;
  const activeText = fmtActiveLabel(count);
  const distText = fmtDistanceAway(b.distance_m);
  return `<div class="bubble-card-details">
    <span class="bubble-card-detail bubble-card-detail--active">
      <span class="bubble-card-detail-icon" aria-hidden="true">${live ? "🟢" : "⚪"}</span>
      ${escapeHtml(activeText)}
    </span>
    <span class="bubble-card-detail bubble-card-detail--distance">
      <span class="bubble-card-detail-icon" aria-hidden="true">📍</span>
      ${escapeHtml(distText)}
    </span>
  </div>`;
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

function questionMarkerHtml(q) {
  const replies = Number(q.reply_count) || 0;
  const hot = replies >= 3;
  return `<div class="map-question-marker${hot ? " map-question-marker--hot" : ""}" data-question-id="${escapeHtml(q.id)}" title="${escapeHtml(q.title || "Question")}">
    <span class="map-question-marker-icon" aria-hidden="true">?</span>
    ${replies > 0 ? `<span class="map-question-marker-count">${replies}</span>` : ""}
  </div>`;
}

function questionMarkerFingerprint(q) {
  return `${q.id}|${q.latitude}|${q.longitude}|r:${q.reply_count || 0}`;
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
  questionMarkersLayer = L.layerGroup().addTo(map);

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

function syncMapQuestionMarkers(questions) {
  ensureMap();
  if (!map || !questionMarkersLayer) return;

  const valid = (questions || []).filter(
    (q) => Number.isFinite(q.latitude) && Number.isFinite(q.longitude),
  );
  const nextIds = new Set(valid.map((q) => q.id));

  for (const [id, marker] of questionMarkerById) {
    if (!nextIds.has(id)) {
      questionMarkersLayer.removeLayer(marker);
      questionMarkerById.delete(id);
      questionMarkerStateById.delete(id);
    }
  }

  for (const q of valid) {
    const latlng = [q.latitude, q.longitude];
    const fp = questionMarkerFingerprint(q);
    let marker = questionMarkerById.get(q.id);
    const icon = L.divIcon({
      className: "map-question-marker-wrap",
      html: questionMarkerHtml(q),
      iconSize: [32, 36],
      iconAnchor: [16, 18],
    });

    if (marker) {
      marker.setLatLng(latlng);
      if (questionMarkerStateById.get(q.id) !== fp) {
        marker.setIcon(icon);
        questionMarkerStateById.set(q.id, fp);
      }
    } else {
      marker = L.marker(latlng, { icon, zIndexOffset: 200 });
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        window.location.href = questionHref(q.id);
      });
      marker.addTo(questionMarkersLayer);
      questionMarkerById.set(q.id, marker);
      questionMarkerStateById.set(q.id, fp);
    }
  }
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

  return `<article class="${cls}" data-bubble-id="${escapeHtml(b.id)}" tabindex="0" role="button" aria-label="${escapeHtml(b.title || "Community")}">
    <div class="bubble-card-body">
      <h3 class="bubble-card-title">${escapeHtml(b.title || "Community")}</h3>
      ${bubbleCardDetailsHtml(b)}
    </div>
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
  if (titleEl) titleEl.textContent = b.title || "Community";

  const detailsEl = el.querySelector(".bubble-card-details");
  if (detailsEl) {
    const wrap = document.createElement("div");
    wrap.innerHTML = bubbleCardDetailsHtml(b);
    detailsEl.replaceWith(wrap.firstElementChild);
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

function bindQuestionCard(el) {
  if (!el || el.dataset.bound === "1") return;
  el.dataset.bound = "1";
  const go = () => {
    window.location.href = questionHref(el.dataset.questionId);
  };
  el.addEventListener("click", go);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      go();
    }
  });
}

function syncQuestionSection(container, items) {
  syncOrderedList(container, items, {
    fingerprint: questionFingerprint,
    render: (q) => createQuestionCardElement(q, { escapeHtml }),
    update: (el, q) => {
      const titleEl = el.querySelector(".question-card-title");
      if (titleEl) titleEl.textContent = q.title || "Question";
      const answersEl = el.querySelector(".question-card-stat--answers");
      if (answersEl) {
        const count = Number(q.reply_count) || 0;
        answersEl.textContent = `${count} repl${count === 1 ? "y" : "ies"}`;
      }
      const footStats = el.querySelectorAll(".question-card-foot .question-card-stat:not(.question-card-stat--answers)");
      const metaTail = questionCardMeta(q).split(" · ").slice(1).join(" · ");
      if (footStats[0]) footStats[0].textContent = metaTail;
    },
    bind: bindQuestionCard,
  });
}

function renderQuestionFeedSection(questions, limit = null) {
  const items = limit == null ? questions : questions.slice(0, limit);
  renderFeedSection("#feed-questions-section", "#feed-questions", items, {
    isQuestions: true,
  });
}

function renderFeedSection(sectionId, containerId, items, options = {}) {
  const section = $(sectionId);
  const container = $(containerId);
  if (!container) return;

  if (items.length) {
    section?.removeAttribute("hidden");
    if (options.isQuestions) {
      syncQuestionSection(container, items);
    } else {
      syncFeedSection(container, items, options);
    }
  } else {
    section?.setAttribute("hidden", "hidden");
    container.replaceChildren();
  }
}

let feedSearchQuery = "";
let feedSearchModeActive = false;

const FEED_TABS = ["for-you", "questions", "communities", "map"];
const FEED_TAB_SWIPE_THRESHOLD = 52;
const FEED_TAB_SWIPE_MAX_VERTICAL = 48;
const HERO_DISMISSED_KEY = "bbl_hero_dismissed";

let activeFeedTab = "communities";
const feedTabScrollPositions = { "for-you": 0, questions: 0, communities: 0, map: 0 };
let feedTabSwipeStart = null;
let heroDismissListener = null;

function setFeedTabsVisible(visible) {
  $("#feed-tabs-wrap")?.toggleAttribute("hidden", !visible);
  $("#feed-tab-panels")?.toggleAttribute("hidden", !visible);
}

function applyFeedTabPanel(tab) {
  if (!FEED_TABS.includes(tab)) return;
  activeFeedTab = tab;

  document.querySelectorAll(".feed-tab").forEach((btn) => {
    const on = btn.dataset.feedTab === tab;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });

  document.querySelectorAll(".feed-tab-panel").forEach((panel) => {
    const on = panel.dataset.feedTabPanel === tab;
    panel.classList.toggle("is-active", on);
    panel.toggleAttribute("hidden", !on);
  });

  updateFeedTabActions(tab);

  if (tab === "map") {
    ensureMap();
    invalidateMapSoon();
  }
}

function updateFeedTabActions(tab) {
  const bar = $("#feed-tab-actions");
  const askBtn = $("#feed-tab-action-ask");
  const createBtn = $("#feed-tab-action-create");
  const showBar = tab === "questions" || tab === "communities";
  if (bar) bar.hidden = !showBar || !feedTabsInteractive();
  askBtn?.toggleAttribute("hidden", tab !== "questions");
  createBtn?.toggleAttribute("hidden", tab !== "communities");
}

function dismissHero() {
  const hero = $("#home-hero");
  if (!hero || hero.hidden) return;
  safeSetItem(HERO_DISMISSED_KEY, "1");
  hero.classList.add("home-hero--collapsed");
  window.setTimeout(() => {
    hero.hidden = true;
  }, 260);
  if (heroDismissListener) {
    $("#home-feed-scroll")?.removeEventListener("scroll", heroDismissListener);
    heroDismissListener = null;
  }
}

function initHeroBehavior() {
  const hero = $("#home-hero");
  if (!hero) return;
  if (safeGetItem(HERO_DISMISSED_KEY) === "1") {
    hero.hidden = true;
    hero.classList.add("home-hero--collapsed");
    return;
  }
  hero.hidden = false;
  hero.classList.remove("home-hero--collapsed");
  if (heroDismissListener) return;
  heroDismissListener = () => {
    if (($("#home-feed-scroll")?.scrollTop ?? 0) > 8) dismissHero();
  };
  $("#home-feed-scroll")?.addEventListener("scroll", heroDismissListener, { passive: true });
}

function setFeedTab(tab, { restoreScroll = false, saveCurrent = true } = {}) {
  if (!FEED_TABS.includes(tab)) return;

  const scrollEl = $("#home-feed-scroll");
  if (saveCurrent && scrollEl && tab !== activeFeedTab) {
    feedTabScrollPositions[activeFeedTab] = scrollEl.scrollTop;
  }

  applyFeedTabPanel(tab);

  if (restoreScroll && scrollEl) {
    requestAnimationFrame(() => {
      scrollEl.scrollTop = feedTabScrollPositions[tab] ?? 0;
    });
  }
}

function updateFeedTabCounts(questions, bubbles) {
  const qCount = questions.length;
  const cCount = bubbles.length;
  const qEl = $("#feed-tab-count-questions");
  const cEl = $("#feed-tab-count-communities");
  if (qEl) {
    qEl.textContent = qCount > 0 ? ` (${qCount})` : "";
    qEl.hidden = qCount === 0;
  }
  if (cEl) {
    cEl.textContent = cCount > 0 ? ` (${cCount})` : "";
    cEl.hidden = cCount === 0;
  }
}

function sectionIsVisible(sectionId) {
  const el = $(sectionId);
  return el && !el.hasAttribute("hidden");
}

function updateFeedTabEmptyStates() {
  const forYouHas =
    sectionIsVisible("#feed-recommended-section") || sectionIsVisible("#feed-discover-section");
  $("#feed-tab-empty-for-you")?.toggleAttribute("hidden", forYouHas);

  const questionsHas = sectionIsVisible("#feed-questions-section");
  $("#feed-tab-empty-questions")?.toggleAttribute("hidden", questionsHas);

  const communitiesHas =
    sectionIsVisible("#feed-nearby-section") ||
    sectionIsVisible("#feed-trending-section") ||
    sectionIsVisible("#feed-recent-section");
  $("#feed-tab-empty-communities")?.toggleAttribute("hidden", communitiesHas);
}

function feedTabsInteractive() {
  return !feedSearchModeActive && !feedSearchQuery.trim() && feedLoadedOnce;
}

function setupFeedTabGestures() {
  const area = $("#home-feed-scroll");
  if (!area || area.dataset.feedSwipeBound === "1") return;
  area.dataset.feedSwipeBound = "1";

  area.addEventListener(
    "touchstart",
    (e) => {
      if (!feedTabsInteractive() || activeFeedTab === "map") return;
      if (e.target.closest(".leaflet-container, .map-tab-map-wrap")) return;
      const t = e.changedTouches[0];
      feedTabSwipeStart = { x: t.clientX, y: t.clientY };
    },
    { passive: true },
  );

  area.addEventListener(
    "touchend",
    (e) => {
      if (!feedTabSwipeStart || !feedTabsInteractive() || activeFeedTab === "map") return;
      if (e.target.closest(".leaflet-container, .map-tab-map-wrap")) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - feedTabSwipeStart.x;
      const dy = t.clientY - feedTabSwipeStart.y;
      feedTabSwipeStart = null;
      if (Math.abs(dy) > FEED_TAB_SWIPE_MAX_VERTICAL && Math.abs(dy) > Math.abs(dx)) return;
      if (Math.abs(dx) < FEED_TAB_SWIPE_THRESHOLD) return;
      const idx = FEED_TABS.indexOf(activeFeedTab);
      if (dx < 0 && idx < FEED_TABS.length - 1) {
        setFeedTab(FEED_TABS[idx + 1], { restoreScroll: true });
      } else if (dx > 0 && idx > 0) {
        setFeedTab(FEED_TABS[idx - 1], { restoreScroll: true });
      }
    },
    { passive: true },
  );
}

function setupFeedTabs() {
  document.querySelectorAll(".feed-tab").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const tab = btn.dataset.feedTab;
      if (tab && tab !== activeFeedTab) setFeedTab(tab, { restoreScroll: true });
    });
  });
  setupFeedTabGestures();
}

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
  hideSearchResultSections();
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
  if (active) {
    setFeedTabsVisible(false);
    $("#feed-tab-actions")?.setAttribute("hidden", "hidden");
  }
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
  $("#feed-questions-section")?.setAttribute("hidden", "hidden");
  $("#feed-recommended-section")?.setAttribute("hidden", "hidden");
  $("#feed-nearby-section")?.setAttribute("hidden", "hidden");
  $("#feed-trending-section")?.setAttribute("hidden", "hidden");
  $("#feed-recent-section")?.setAttribute("hidden", "hidden");
  $("#feed-discover-section")?.setAttribute("hidden", "hidden");
  $("#feed-map-communities-section")?.setAttribute("hidden", "hidden");
  $("#feed-map-questions-section")?.setAttribute("hidden", "hidden");
  $("#feed-questions")?.replaceChildren();
  $("#feed-recommended")?.replaceChildren();
  $("#feed-nearby")?.replaceChildren();
  $("#feed-trending")?.replaceChildren();
  $("#feed-recent")?.replaceChildren();
  $("#feed-discover")?.replaceChildren();
  $("#feed-map-communities")?.replaceChildren();
  $("#feed-map-questions")?.replaceChildren();
}

function renderMapTabDiscover(bubbles, questions) {
  const nearby = sortByDistance(bubbles).slice(0, 6);
  renderFeedSection("#feed-map-communities-section", "#feed-map-communities", nearby, {
    allBubbles: bubbles,
  });
  const qItems = questions.slice(0, 6);
  if (qItems.length) {
    $("#feed-map-questions-section")?.removeAttribute("hidden");
    syncQuestionSection($("#feed-map-questions"), qItems);
  } else {
    $("#feed-map-questions-section")?.setAttribute("hidden", "hidden");
    $("#feed-map-questions")?.replaceChildren();
  }
}

function renderStandardFeedSections(bubbles, questions) {
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
    const totalActive = bubbles.reduce((s, b) => s + activeUsers(b), 0);
    if (totalActive > 0) {
      countEl.textContent = `${totalActive} active people nearby`;
    } else if (nearbyCommunities.length) {
      countEl.textContent = `${nearbyCommunities.length} communit${nearbyCommunities.length === 1 ? "y" : "ies"} nearby`;
    } else {
      countEl.textContent = "";
    }
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
  renderQuestionFeedSection(questions);
  renderMapTabDiscover(bubbles, questions);
  updateFeedTabCounts(questions, bubbles);
  updateFeedTabEmptyStates();
  updateFeedTabActions(activeFeedTab);
}

function hideSearchResultSections() {
  $("#feed-search-section")?.setAttribute("hidden", "hidden");
  $("#feed-search-results")?.replaceChildren();
  $("#feed-search-communities-section")?.setAttribute("hidden", "hidden");
  $("#feed-search-communities")?.replaceChildren();
  $("#feed-search-questions-section")?.setAttribute("hidden", "hidden");
  $("#feed-search-questions")?.replaceChildren();
}

function renderSearchFeed(bubbles, questions, query) {
  const searchEmpty = $("#feed-search-empty");
  const communityResults = sortByDistance(filterBubblesBySearch(bubbles, query));
  const questionResults = filterQuestionsBySearch(questions, query);

  hideStandardFeedSections();
  $("#feed-recent-searches-section")?.setAttribute("hidden", "hidden");
  $("#feed-recent-searches-list")?.replaceChildren();
  $("#feed-search-hint")?.setAttribute("hidden", "hidden");
  hideSearchResultSections();
  $("#home-empty")?.setAttribute("hidden", "hidden");
  $("#home-feed")?.classList.remove("home-feed--empty");
  document.querySelector(".home-legal-footer")?.toggleAttribute("hidden", feedSearchModeActive);

  const total = communityResults.length + questionResults.length;
  if (!total) {
    searchEmpty?.removeAttribute("hidden");
    return;
  }

  searchEmpty?.setAttribute("hidden", "hidden");

  if (questionResults.length) {
    $("#feed-search-questions-section")?.removeAttribute("hidden");
    const countEl = $("#feed-search-questions-count");
    if (countEl) countEl.textContent = `${questionResults.length}`;
    syncQuestionSection($("#feed-search-questions"), questionResults);
  }

  if (communityResults.length) {
    $("#feed-search-communities-section")?.removeAttribute("hidden");
    const countEl = $("#feed-search-communities-count");
    if (countEl) countEl.textContent = `${communityResults.length}`;
    syncFeedSection($("#feed-search-communities"), communityResults, { allBubbles: bubbles });
  }
}

function renderSearchModeFeed(bubbles, questions, query) {
  hideStandardFeedSections();
  $("#home-empty")?.setAttribute("hidden", "hidden");
  $("#home-feed")?.classList.remove("home-feed--empty");
  document.querySelector(".home-legal-footer")?.setAttribute("hidden", "hidden");

  if (query.length > 0) {
    renderSearchFeed(bubbles, questions, query);
    return;
  }

  hideSearchAuxiliarySections();
  renderRecentSearches();
}

function renderBubbleFeed(bubbles, questions = hooks.getNearbyQuestions?.() || []) {
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
    setFeedTabsVisible(false);
    emptyEl?.setAttribute("hidden", "hidden");
    return;
  }

  if (inSearchMode) {
    setFeedTabsVisible(false);
    renderSearchModeFeed(bubbles, questions, query);
  } else if (isFiltering) {
    setFeedTabsVisible(false);
    hideSearchAuxiliarySections();
    document.querySelector(".home-legal-footer")?.removeAttribute("hidden");
    renderSearchFeed(bubbles, questions, query);
  } else {
    hideSearchAuxiliarySections();
    document.querySelector(".home-legal-footer")?.removeAttribute("hidden");
    renderStandardFeedSections(bubbles, questions);
    setFeedTabsVisible(true);
    applyFeedTabPanel(activeFeedTab);

    const showEmpty = bubbles.length === 0 && questions.length === 0;
    if (emptyEl) emptyEl.hidden = !showEmpty;
    feedEl?.classList.toggle("home-feed--empty", showEmpty);
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
    setFeedTabsVisible(false);
    $("#feed-questions-section")?.setAttribute("hidden", "hidden");
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
  const textEl = el?.querySelector(".live-nearby-text");
  const feedLive = $("#feed-live-text");
  const feedStrip = $("#feed-live-strip");
  const total = bubbles.reduce((s, b) => s + activeUsers(b), 0);
  let text = "Discover nearby";
  let live = false;
  if (total > 0) {
    text = `${total} ${total === 1 ? "local" : "locals"} active`;
    live = true;
  } else if (bubbles.length > 0) {
    text = `${bubbles.length} communit${bubbles.length === 1 ? "y" : "ies"} nearby`;
  }
  if (textEl) textEl.textContent = text;
  if (feedLive) feedLive.textContent = text;
  if (el) el.dataset.state = live ? "live" : "idle";
  feedStrip?.classList.toggle("feed-live-strip--live", live);
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
  $("#ask-question-sheet")?.setAttribute("hidden", "hidden");
  $("#sheet-backdrop")?.setAttribute("hidden", "hidden");
  document.body.classList.remove("sheet-open");
  clearSimilarResults();
}

function populateQuestionCommunitySelect() {
  const select = $("#ask-question-community");
  if (!select) return;
  const bubbles = hooks.getNearbyBubbles?.() || [];
  const current = select.value;
  select.replaceChildren(
    Object.assign(document.createElement("option"), {
      value: "",
      textContent: "No community — ask everyone nearby",
    }),
    ...bubbles.map((b) =>
      Object.assign(document.createElement("option"), {
        value: b.id,
        textContent: b.title || "Community",
      }),
    ),
  );
  if (current) select.value = current;
}

function openAskQuestionSheet() {
  populateQuestionCommunitySelect();
  const title = $("#ask-question-title");
  const desc = $("#ask-question-desc");
  if (title) title.value = "";
  if (desc) desc.value = "";
  $("#ask-question-error")?.setAttribute("hidden", "hidden");
  openSheet("#ask-question-sheet");
  setTimeout(() => title?.focus(), 200);
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

  const openCreate = () => {
    if (!hooks.hasPosition?.()) {
      showOnboarding("Enable location to create a community where you are.");
      return;
    }
    openCreateSheet();
  };

  const openAsk = () => {
    if (!hooks.hasPosition?.()) {
      showOnboarding("Enable location to ask a question nearby.");
      return;
    }
    openAskQuestionSheet();
  };

  $("#feed-tab-action-create")?.addEventListener("click", openCreate);
  $("#feed-tab-action-ask")?.addEventListener("click", openAsk);

  $("#ask-question-close")?.addEventListener("click", closeAllSheets);

  $("#ask-question-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#ask-question-title")?.value.trim();
    if (!title) return;
    const errEl = $("#ask-question-error");
    const btn = $("#ask-question-submit");
    if (btn) btn.disabled = true;
    try {
      if (!hooks.hasPosition?.()) await hooks.ensureLocation?.();
      await hooks.saveName?.();
      const body = {
        title,
        description: $("#ask-question-desc")?.value.trim() || "",
        latitude: hooks.getPosition().lat,
        longitude: hooks.getPosition().lng,
      };
      const communityId = $("#ask-question-community")?.value;
      if (communityId) body.bubble_id = communityId;
      const res = await fetch("/api/questions/", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = "Could not post question. Try again.";
        }
        return;
      }
      const q = await res.json();
      closeAllSheets();
      window.location.href = questionHref(q.id);
    } catch {
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = "Location or network error.";
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("#home-empty-create")?.addEventListener("click", () => {
    if (!hooks.hasPosition?.()) {
      showOnboarding("Enable location to create a community where you are.");
      return;
    }
    openCreateSheet();
  });

  $("#feed-search")?.addEventListener("focus", () => {
    if (isMobileSearchLayout()) enterSearchMode();
  });

  setupFeedTabs();
  initHeroBehavior();

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
    openCreateSheet();
  });

  $("#feed-search-empty-ask")?.addEventListener("click", () => {
    exitSearchMode({ clearQuery: false });
    openAskQuestionSheet();
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
    const questions = hooks.getNearbyQuestions?.() || [];
    if (bubbles.length || questions.length) renderBubbleFeed(bubbles, questions);
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

export function onMapBubblesUpdated(bubbles, questions = hooks.getNearbyQuestions?.() || []) {
  syncMapMarkers(bubbles);
  syncMapQuestionMarkers(questions);
  renderBubbleFeed(bubbles, questions);
}
