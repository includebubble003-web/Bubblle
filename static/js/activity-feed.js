/**
 * Unified "Happening Around You" activity feed — conversation-first cards.
 */
import { activeUsers } from "./bubble-sync.js";
import { fmtReplyCountReplies, fmtTimeAgo, questionHref } from "./questions.js";
import { topicIcon } from "./topic-icons.js";

const API_FETCH = { credentials: "include", cache: "no-store" };
const previewCache = new Map();
let previewHydrateGen = 0;

function bubbleHref(id) {
  return `/bubble/${id}/`;
}

function activityTs(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function scoreCommunity(b) {
  const users = activeUsers(b);
  const dist = Number(b.distance_m) || 0;
  const distScore = Math.max(0, 5000 - dist) / 5000;
  return users * 120 + distScore * 40 + (users >= 2 ? 30 : 0);
}

function scoreQuestion(q) {
  const replies = Number(q.reply_count) || 0;
  const dist = Number(q.distance_m) || 0;
  const distScore = Math.max(0, 5000 - dist) / 5000;
  const ageHrs = (Date.now() - activityTs(q.last_activity_at || q.created_at)) / 3600000;
  const recency = Math.max(0, 72 - ageHrs) / 72;
  return replies * 18 + recency * 55 + distScore * 25 + (replies >= 3 ? 20 : 0);
}

/** Break long runs of the same type so the feed feels naturally mixed. */
function mixActivityFeed(sorted) {
  if (sorted.length <= 2) return sorted;
  const out = [...sorted];
  for (let i = 1; i < out.length; i++) {
    if (out[i].type === out[i - 1].type) {
      for (let j = i + 1; j < Math.min(i + 6, out.length); j++) {
        if (out[j].type !== out[i].type) {
          [out[i], out[j]] = [out[j], out[i]];
          break;
        }
      }
    }
  }
  return out;
}

export function buildActivityFeed(bubbles = [], questions = [], { mode = "all" } = {}) {
  const items = [];

  if (mode === "all" || mode === "questions") {
    for (const q of questions) {
      items.push({
        key: `q:${q.id}`,
        type: "question",
        data: q,
        score: scoreQuestion(q),
      });
    }
  }

  if (mode === "all" || mode === "communities") {
    for (const b of bubbles) {
      items.push({
        key: `c:${b.id}`,
        type: "community",
        data: b,
        score: scoreCommunity(b),
      });
    }
  }

  return mixActivityFeed(items.sort((a, b) => b.score - a.score));
}

export function activityFingerprint(item, preview = "") {
  const d = item.data;
  if (item.type === "question") {
    return `${item.key}|r:${d.reply_count || 0}|a:${d.last_activity_at || ""}|p:${preview}`;
  }
  return `${item.key}|u:${activeUsers(d)}|p:${preview}`;
}

function truncatePreview(text, max = 72) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function communityHook(b) {
  const users = activeUsers(b);
  if (users >= 2) return "Latest discussion";
  if (users > 0) return "Latest";
  return "Start the conversation";
}

function communityMeta(b) {
  const users = activeUsers(b);
  if (users > 0) return `${users} ${users === 1 ? "person" : "people"} active`;
  return "Be the first to join";
}

function questionHook(q) {
  const replies = Number(q.reply_count) || 0;
  if (replies > 0) return "Latest reply";
  return "Be the first to answer";
}

function questionTimeLabel(q) {
  const ago = fmtTimeAgo(q.last_activity_at || q.created_at);
  if (!ago) return "Asked recently";
  return `Asked ${ago}`;
}

function activityKindLabel(item) {
  if (item.type === "question") {
    const q = item.data;
    const replies = Number(q.reply_count) || 0;
    const ageHrs = (Date.now() - activityTs(q.created_at)) / 3600000;
    if (replies >= 5) return "🔥 Trending question";
    if (replies > 0) return "💬 Active discussion";
    if (ageHrs < 12) return "❓ New question";
    return "❓ Question nearby";
  }
  const users = activeUsers(item.data);
  if (users >= 3) return "🔥 Active community";
  if (users > 0) return "💬 Live chat";
  return "✨ New community";
}

function titleWithEmoji(emoji, title, esc) {
  return `<span class="activity-card-emoji" aria-hidden="true">${emoji}</span> ${esc(title || "")}`;
}

export function activityCardHtml(item, { escapeHtml, preview = "" } = {}) {
  const esc = escapeHtml || ((s) => String(s));
  const previewText = truncatePreview(preview);
  const joinCta = `<a href="${esc(item.type === "question" ? questionHref(item.data.id) : bubbleHref(item.data.id))}" class="activity-card-cta">Join →</a>`;

  if (item.type === "question") {
    const q = item.data;
    const emoji = topicIcon(q.title, { kind: "question" });
    const replies = Number(q.reply_count) || 0;
    const hook = questionHook(q);
    const kind = activityKindLabel(item);
    const previewLine = previewText
      ? `"${esc(previewText)}"`
      : replies > 0
        ? `<span class="activity-card-preview--pending">Loading latest reply…</span>`
        : `<span class="activity-card-preview--empty">No answers yet — jump in</span>`;

    return `<article class="activity-card activity-card--question" data-activity-key="${esc(item.key)}" data-activity-type="question" data-entity-id="${esc(q.id)}" tabindex="0" role="link">
      <div class="activity-card-body">
        <p class="activity-card-kind">${esc(kind)}</p>
        <h3 class="activity-card-title">${titleWithEmoji(emoji, q.title || "Question", esc)}</h3>
        <p class="activity-card-hook">${esc(hook)}</p>
        <p class="activity-card-preview">${previewLine}</p>
        <div class="activity-card-meta">
          <span>${esc(fmtReplyCountReplies(replies))}</span>
          <span>${esc(questionTimeLabel(q))}</span>
        </div>
      </div>
      ${joinCta}
    </article>`;
  }

  const b = item.data;
  const emoji = topicIcon(b.title, { kind: "community" });
  const hook = communityHook(b);
  const kind = activityKindLabel(item);
  const previewLine = previewText
    ? `"${esc(previewText)}"`
    : activeUsers(b) > 0
      ? `<span class="activity-card-preview--pending">Loading latest message…</span>`
      : `<span class="activity-card-preview--empty">Say hello to the group</span>`;

  return `<article class="activity-card activity-card--community" data-activity-key="${esc(item.key)}" data-activity-type="community" data-entity-id="${esc(b.id)}" tabindex="0" role="button">
    <div class="activity-card-body">
      <p class="activity-card-kind">${esc(kind)}</p>
      <h3 class="activity-card-title">${titleWithEmoji(emoji, b.title || "Community", esc)}</h3>
      <p class="activity-card-hook">${esc(hook)}</p>
      <p class="activity-card-preview">${previewLine}</p>
      <div class="activity-card-meta">
        <span>${esc(communityMeta(b))}</span>
      </div>
    </div>
    ${joinCta}
  </article>`;
}

export function createActivityCardElement(item, opts = {}) {
  const wrap = document.createElement("div");
  wrap.innerHTML = activityCardHtml(item, opts);
  return wrap.firstElementChild;
}

export function applyActivityCardState(el, item, { escapeHtml, preview = "" } = {}) {
  const esc = escapeHtml || ((s) => String(s));
  const previewText = truncatePreview(preview);

  if (item.type === "question") {
    const q = item.data;
    const emoji = topicIcon(q.title, { kind: "question" });
    const kindEl = el.querySelector(".activity-card-kind");
    const hookEl = el.querySelector(".activity-card-hook");
    const previewEl = el.querySelector(".activity-card-preview");
    const metaEl = el.querySelector(".activity-card-meta");
    const titleEl = el.querySelector(".activity-card-title");
    if (kindEl) kindEl.textContent = activityKindLabel(item);
    if (titleEl) titleEl.innerHTML = titleWithEmoji(emoji, q.title || "Question", esc);
    if (hookEl) hookEl.textContent = questionHook(q);
    if (previewEl) {
      const replies = Number(q.reply_count) || 0;
      previewEl.innerHTML = previewText
        ? `"${esc(previewText)}"`
        : replies > 0
          ? `<span class="activity-card-preview--pending">Loading latest reply…</span>`
          : `<span class="activity-card-preview--empty">No answers yet — jump in</span>`;
    }
    if (metaEl) {
      metaEl.innerHTML = `<span>${esc(fmtReplyCountReplies(q.reply_count))}</span><span>${esc(questionTimeLabel(q))}</span>`;
    }
    const cta = el.querySelector(".activity-card-cta");
    if (cta) cta.href = questionHref(q.id);
    return;
  }

  const b = item.data;
  const emoji = topicIcon(b.title, { kind: "community" });
  const kindEl = el.querySelector(".activity-card-kind");
  const titleEl = el.querySelector(".activity-card-title");
  const hookEl = el.querySelector(".activity-card-hook");
  const previewEl = el.querySelector(".activity-card-preview");
  const metaEl = el.querySelector(".activity-card-meta");
  if (kindEl) kindEl.textContent = activityKindLabel(item);
  if (titleEl) titleEl.innerHTML = titleWithEmoji(emoji, b.title || "Community", esc);
  if (hookEl) hookEl.textContent = communityHook(b);
  if (previewEl) {
    previewEl.innerHTML = previewText
      ? `"${esc(previewText)}"`
      : activeUsers(b) > 0
        ? `<span class="activity-card-preview--pending">Loading latest message…</span>`
        : `<span class="activity-card-preview--empty">Say hello to the group</span>`;
  }
  if (metaEl) metaEl.innerHTML = `<span>${esc(communityMeta(b))}</span>`;
  const cta = el.querySelector(".activity-card-cta");
  if (cta) cta.href = bubbleHref(b.id);
}

async function fetchCommunityPreview(bubbleId) {
  const cacheKey = `c:${bubbleId}`;
  if (previewCache.has(cacheKey)) return previewCache.get(cacheKey);
  try {
    const res = await fetch(`/api/bubbles/${bubbleId}/messages/?limit=1`, API_FETCH);
    if (!res.ok) return "";
    const data = await res.json();
    const results = data.results || [];
    const last = results[results.length - 1];
    let text = last?.message || "";
    if (!text && last?.image_url) text = "📷 Photo";
    if (!text && last?.pdf_url) text = "📄 PDF";
    previewCache.set(cacheKey, text);
    return text;
  } catch {
    return "";
  }
}

async function fetchQuestionPreview(questionId) {
  const cacheKey = `q:${questionId}`;
  if (previewCache.has(cacheKey)) return previewCache.get(cacheKey);
  try {
    const res = await fetch(`/api/questions/${questionId}/replies/?limit=1`, API_FETCH);
    if (!res.ok) return "";
    const data = await res.json();
    const results = data.results || [];
    const last = results[results.length - 1];
    const text = last?.message || "";
    previewCache.set(cacheKey, text);
    return text;
  } catch {
    return "";
  }
}

export async function hydrateActivityPreviews(container, items, { escapeHtml, limit = 16 } = {}) {
  if (!container) return;
  const gen = ++previewHydrateGen;
  const slice = items.slice(0, limit);

  await Promise.all(
    slice.map(async (item) => {
      const id = item.data.id;
      let preview = "";
      if (item.type === "community") {
        preview = await fetchCommunityPreview(id);
      } else if (item.type === "question" && (Number(item.data.reply_count) || 0) > 0) {
        preview = await fetchQuestionPreview(id);
      }
      if (gen !== previewHydrateGen) return;
      const el = container.querySelector(`[data-activity-key="${item.key}"]`);
      if (!el) return;
      applyActivityCardState(el, item, { escapeHtml, preview });
    }),
  );
}

export function bindActivityCard(el, { onCommunityClick } = {}) {
  if (!el || el.dataset.bound === "1") return;
  el.dataset.bound = "1";

  const go = (href) => {
    if (href) window.location.href = href;
  };

  el.addEventListener("click", (e) => {
    if (e.target.closest(".activity-card-cta")) return;
    const type = el.dataset.activityType;
    const id = el.dataset.entityId;
    if (type === "community" && onCommunityClick) {
      e.preventDefault();
      onCommunityClick(id);
      return;
    }
    const cta = el.querySelector(".activity-card-cta");
    if (cta?.href) go(cta.href);
  });

  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const type = el.dataset.activityType;
    const id = el.dataset.entityId;
    if (type === "community" && onCommunityClick) {
      onCommunityClick(id);
      return;
    }
    const cta = el.querySelector(".activity-card-cta");
    if (cta?.href) go(cta.href);
  });
}
