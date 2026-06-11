/**
 * Shared helpers for incremental bubble list updates (no full innerHTML rebuilds).
 */

export function activeUsers(b) {
  return b.active_users ?? b.online_count ?? 0;
}

export function bubbleFingerprint(b) {
  const count = activeUsers(b);
  const dist = Number.isFinite(Number(b.distance_m)) ? Math.round(Number(b.distance_m)) : "";
  const expiry = b.expires_at ?? b.remaining_seconds ?? "";
  return `${b.id}|${count}|${dist}|${expiry}|${b.title ?? ""}|${b.latitude}|${b.longitude}`;
}

export function bubblesFingerprint(bubbles) {
  return bubbles.map(bubbleFingerprint).sort().join(";");
}

export function markerFingerprint(b, { trending = false, selected = false } = {}) {
  return `${b.latitude},${b.longitude},${activeUsers(b)},${trending ? 1 : 0},${selected ? 1 : 0}`;
}

/**
 * Reorder/update a list container while preserving existing DOM nodes when possible.
 * @param {HTMLElement | null} container
 * @param {Array} orderedItems
 * @param {{ render: Function, update: Function, bind?: Function }} handlers
 */
export function syncOrderedList(container, orderedItems, { render, update, bind, fingerprint = bubbleFingerprint }) {
  if (!container) return;

  const existing = new Map();
  container.querySelectorAll("[data-bubble-id]").forEach((el) => {
    existing.set(el.dataset.bubbleId, el);
  });

  const nextIds = new Set(orderedItems.map((b) => b.id));
  for (const [id, el] of existing) {
    if (!nextIds.has(id)) {
      el.remove();
      existing.delete(id);
    }
  }

  let prevEl = null;
  for (const item of orderedItems) {
    const fp = fingerprint(item);
    let el = existing.get(item.id);

    if (el) {
      if (el.dataset.fp !== fp) {
        update(el, item);
        el.dataset.fp = fp;
      }
      const anchor = prevEl ? prevEl.nextSibling : container.firstChild;
      if (el !== anchor) {
        container.insertBefore(el, anchor);
      }
    } else {
      el = render(item);
      if (!el) continue;
      el.dataset.bubbleId = item.id;
      el.dataset.fp = fp;
      bind?.(el);
      container.insertBefore(el, prevEl ? prevEl.nextSibling : container.firstChild);
      existing.set(item.id, el);
    }
    prevEl = el;
  }
}
