/**
 * Local Q&A helpers — question cards, formatting, search matching.
 */
import { topicIcon } from "./topic-icons.js";

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

export function fmtReplyCountReplies(n) {
  const count = Number(n) || 0;
  return `${count} repl${count === 1 ? "y" : "ies"}`;
}

export function fmtQuestionDistanceAway(m) {
  const d = fmtQuestionDistance(m);
  if (!d) return "";
  return `${d.replace(/\s+/g, "")} away`;
}

export function fmtTimeAgoLong(iso) {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) === 1 ? "" : "s"} ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
  const replies = Number(q.reply_count) || 0;
  const emoji = topicIcon(q.title, { kind: "question" });
  const timeLabel = fmtTimeAgo(q.last_activity_at || q.created_at) || "recently";
  const hook = replies > 0 ? "Latest:" : "Be the first to answer";

  return `<article class="activity-card activity-card--question question-card" data-question-id="${escapeHtml(q.id)}" tabindex="0" role="link">
    <div class="activity-card-icon question-card-qmark" aria-hidden="true">${emoji}</div>
    <div class="activity-card-body question-card-body">
      <h3 class="activity-card-title question-card-title">${escapeHtml(q.title || "Question")}</h3>
      <p class="activity-card-hook">${escapeHtml(hook)}</p>
      <p class="activity-card-preview question-card-preview--empty">Tap to see the discussion</p>
      <div class="activity-card-meta question-card-meta-row">
        <span class="question-card-stat question-card-stat--answers">${escapeHtml(fmtReplyCountReplies(replies))}</span>
        <span>${escapeHtml(timeLabel)}</span>
      </div>
    </div>
    <a href="${escapeHtml(questionHref(q.id))}" class="activity-card-cta">Join →</a>
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
