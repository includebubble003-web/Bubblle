/**
 * Unified map entity model — communities and questions as first-class location pins.
 *
 * See docs/MAP_ARCHITECTURE.md for domain model and data flow.
 */
import { activeUsers } from "./bubble-sync.js";
import { questionHref } from "./questions.js";

/** Fixed pin size (px) — both types render identically on the map. */
export const MAP_PIN_SIZE = 40;

export function communityHref(id) {
  return `/bubble/${id}/`;
}

/** Normalize a nearby bubble API row into a map entity. */
export function communityFromBubble(b) {
  return {
    id: String(b.id),
    type: "community",
    title: b.title || "Community",
    latitude: b.latitude,
    longitude: b.longitude,
    distance_m: b.distance_m,
    activeUsers: activeUsers(b),
    href: communityHref(b.id),
  };
}

/** Normalize a nearby question API row into a map entity. */
export function questionFromApi(q) {
  return {
    id: String(q.id),
    type: "question",
    title: q.title || "Question",
    latitude: q.latitude,
    longitude: q.longitude,
    distance_m: q.distance_m,
    replyCount: Number(q.reply_count) || 0,
    bubbleTitle: q.bubble_title || null,
    href: questionHref(q.id),
  };
}

export function mapEntityKey(entity) {
  return `${entity.type}:${entity.id}`;
}

export function mapEntityHref(entity) {
  return entity.href;
}

/** Build unified marker list from parallel nearby API responses. */
export function buildMapEntities(bubbles, questions) {
  const entities = [];
  for (const b of bubbles || []) {
    if (Number.isFinite(b.latitude) && Number.isFinite(b.longitude)) {
      entities.push(communityFromBubble(b));
    }
  }
  for (const q of questions || []) {
    if (Number.isFinite(q.latitude) && Number.isFinite(q.longitude)) {
      entities.push(questionFromApi(q));
    }
  }
  return entities;
}

export function entityMarkerFingerprint(entity, { selected = false } = {}) {
  const sel = selected ? 1 : 0;
  if (entity.type === "question") {
    return `${entity.type}:${entity.id}|r:${entity.replyCount}|s:${sel}`;
  }
  return `${entity.type}:${entity.id}|u:${entity.activeUsers}|s:${sel}`;
}

export function mapPinHtml(entity, { selected = false, escapeHtml }) {
  const emoji = entity.type === "question" ? "❓" : "💬";
  const hot =
    entity.type === "question"
      ? entity.replyCount >= 3
      : entity.activeUsers >= 3;
  const badge =
    entity.type === "question"
      ? entity.replyCount > 0
        ? String(entity.replyCount)
        : ""
      : entity.activeUsers > 0
        ? String(entity.activeUsers)
        : "";

  return `<div class="map-pin map-pin--${entity.type}${hot ? " map-pin--hot" : ""}${selected ? " map-pin--selected" : ""}" data-entity-type="${escapeHtml(entity.type)}" data-entity-id="${escapeHtml(entity.id)}" title="${escapeHtml(entity.title)}">
    <span class="map-pin-emoji" aria-hidden="true">${emoji}</span>
    ${badge ? `<span class="map-pin-badge">${escapeHtml(badge)}</span>` : ""}
  </div>`;
}

export function mapPreviewHtml(entity, { escapeHtml }) {
  const emoji = entity.type === "question" ? "❓" : "💬";

  if (entity.type === "question") {
    const n = entity.replyCount;
    const meta = `${n} ${n === 1 ? "Answer" : "Answers"}`;
    return `<div class="map-preview map-preview--question">
      <div class="map-preview-head">
        <span class="map-preview-emoji" aria-hidden="true">${emoji}</span>
        <div class="map-preview-copy">
          <h3 class="map-preview-title">${escapeHtml(entity.title)}</h3>
          <p class="map-preview-meta">${escapeHtml(meta)}</p>
        </div>
      </div>
      <a href="${escapeHtml(entity.href)}" class="map-preview-action">Open Discussion</a>
    </div>`;
  }

  const n = entity.activeUsers;
  const meta =
    n > 0 ? `${n} Member${n === 1 ? "" : "s"} Active` : "Be the first to join";
  return `<div class="map-preview map-preview--community">
    <div class="map-preview-head">
      <span class="map-preview-emoji" aria-hidden="true">${emoji}</span>
      <div class="map-preview-copy">
        <h3 class="map-preview-title">${escapeHtml(entity.title)}</h3>
        <p class="map-preview-meta">${escapeHtml(meta)}</p>
      </div>
    </div>
    <a href="${escapeHtml(entity.href)}" class="map-preview-action">Open Community</a>
  </div>`;
}
