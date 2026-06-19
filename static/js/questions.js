/**
 * Local Q&A helpers — question cards, formatting, search matching.
 */

export function questionHref(id) {
  return `/question/${id}/`;
}

export function fmtQuestionDistance(m) {
  const d = Number(m);
  if (!Number.isFinite(d)) return "";
  if (d < 1000) return `${Math.round(d)} m`;
  return `${(d / 1000).toFixed(1)} km`;
}

export function fmtQuestionActivity(iso) {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const mins = Math.floor((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return "Active now";
  if (mins < 60) return `Active ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Active ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `Active ${days}d ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtReplyCount(n) {
  const count = Number(n) || 0;
  return `${count} answer${count === 1 ? "" : "s"}`;
}

export function fmtTimeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function authorInitials(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .trim();
}

export function questionMatchesSearch(question, query) {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const haystack = normalizeSearchText(`${question.title} ${question.description || ""}`);
  return haystack.includes(q);
}

export function filterQuestionsBySearch(questions, query) {
  const q = query.trim();
  if (!q) return questions;
  return questions.filter((item) => questionMatchesSearch(item, q));
}

export function questionCardMeta(question) {
  const parts = [fmtReplyCount(question.reply_count)];
  const dist = fmtQuestionDistance(question.distance_m);
  if (dist) parts.push(dist);
  const activity = fmtQuestionActivity(question.last_activity_at);
  if (activity && activity !== "Active now") parts.push(activity);
  return parts.join(" · ");
}

export function questionCardHtml(q, { escapeHtml }) {
  const meta = questionCardMeta(q);
  const community = q.bubble_title
    ? `<span class="question-card-community">${escapeHtml(q.bubble_title)}</span>`
    : "";
  const replies = Number(q.reply_count) || 0;
  const metaTail = meta.split(" · ").slice(1).join(" · ");

  return `<article class="question-card" data-question-id="${escapeHtml(q.id)}" tabindex="0" role="link">
    <div class="question-card-accent" aria-hidden="true"></div>
    <div class="question-card-body">
      <h3 class="question-card-title">${escapeHtml(q.title || "Question")}</h3>
      ${community}
      <div class="question-card-foot">
        <span class="question-card-stat question-card-stat--answers">${replies} answer${replies === 1 ? "" : "s"}</span>
        ${metaTail ? `<span class="question-card-stat">${escapeHtml(metaTail)}</span>` : ""}
      </div>
    </div>
    <span class="question-card-chevron" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </span>
  </article>`;
}

export function createQuestionCardElement(q, { escapeHtml }) {
  const wrap = document.createElement("div");
  wrap.innerHTML = questionCardHtml(q, { escapeHtml });
  return wrap.firstElementChild;
}

export function questionFingerprint(q) {
  return `${q.id}|r:${q.reply_count || 0}|a:${q.last_activity_at || ""}|d:${q.distance_m || 0}`;
}
