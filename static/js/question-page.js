/**
 * Question discussion page — load question, replies, post anonymous answers.
 */
import { fmtQuestionDistance, fmtReplyCount, questionHref } from "./questions.js";

const API_FETCH = { credentials: "include", cache: "no-store" };

let hooks = {};
let questionData = null;
let replyPollTimer = null;

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

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function replyHtml(reply) {
  return `<article class="question-reply" data-reply-id="${escapeHtml(reply.id)}">
    <div class="question-reply-head">
      <span class="question-reply-author">${escapeHtml(reply.anonymous_name)}</span>
      <time class="question-reply-time" datetime="${escapeHtml(reply.created_at)}">${escapeHtml(fmtTime(reply.created_at))}</time>
    </div>
    <p class="question-reply-text">${escapeHtml(reply.message)}</p>
  </article>`;
}

function renderQuestionHeader(q) {
  const titleEl = $("#question-topbar-title");
  if (titleEl) titleEl.textContent = "Question";

  const metaEl = $("#question-page-meta");
  if (metaEl) {
    const parts = [fmtReplyCount(q.reply_count)];
    const dist = fmtQuestionDistance(q.distance_m);
    if (dist) parts.push(dist);
    metaEl.textContent = parts.join(" · ");
  }

  const titleBlock = $("#question-page-title");
  if (titleBlock) titleBlock.textContent = q.title || "Question";

  const descBlock = $("#question-page-description");
  if (descBlock) {
    const desc = (q.description || "").trim();
    if (desc) {
      descBlock.textContent = desc;
      descBlock.hidden = false;
    } else {
      descBlock.hidden = true;
      descBlock.textContent = "";
    }
  }

  const authorEl = $("#question-page-author");
  if (authorEl) authorEl.textContent = `Asked by ${q.anonymous_name}`;

  const communityEl = $("#question-page-community");
  if (communityEl) {
    if (q.bubble_id && q.bubble_title) {
      communityEl.innerHTML = `In <a href="/bubble/${escapeHtml(q.bubble_id)}/">${escapeHtml(q.bubble_title)}</a>`;
      communityEl.hidden = false;
    } else {
      communityEl.hidden = true;
      communityEl.textContent = "";
    }
  }
}

function renderReplies(replies) {
  const list = $("#question-replies");
  const placeholder = $("#question-replies-placeholder");
  if (!list) return;

  if (!replies.length) {
    list.replaceChildren();
    if (placeholder) {
      placeholder.hidden = false;
      placeholder.querySelector(".state-text")?.replaceChildren?.();
      const p = placeholder.querySelector(".state-text");
      if (p) p.textContent = "No replies yet. Be the first to help.";
    }
    return;
  }

  if (placeholder) placeholder.hidden = true;
  list.replaceChildren(
    ...replies.map((r) => {
      const wrap = document.createElement("div");
      wrap.innerHTML = replyHtml(r);
      return wrap.firstElementChild;
    }),
  );
  list.scrollTop = list.scrollHeight;
}

async function loadQuestion() {
  const id = hooks.getQuestionId?.();
  const pos = hooks.getPosition?.();
  if (!id) return;

  const params = new URLSearchParams();
  if (pos) {
    params.set("lat", String(pos.lat));
    params.set("lng", String(pos.lng));
  }

  const res = await fetch(`/api/questions/${id}/?${params}`, API_FETCH);
  if (!res.ok) throw new Error("not_found");
  questionData = await res.json();
  renderQuestionHeader(questionData);
}

async function loadReplies() {
  const id = hooks.getQuestionId?.();
  if (!id) return;

  const res = await fetch(`/api/questions/${id}/replies/?limit=80`, API_FETCH);
  if (!res.ok) return;
  const data = await res.json();
  renderReplies(data.results || []);
}

async function submitReply(text) {
  const id = hooks.getQuestionId?.();
  const pos = hooks.getPosition?.();
  if (!id || !pos) return false;

  await hooks.saveName?.();

  const res = await fetch(`/api/questions/${id}/replies/`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: text,
      latitude: pos.lat,
      longitude: pos.lng,
    }),
  });

  if (!res.ok) return false;
  const reply = await res.json();
  const list = $("#question-replies");
  const placeholder = $("#question-replies-placeholder");
  if (placeholder) placeholder.hidden = true;
  if (list) {
    const wrap = document.createElement("div");
    wrap.innerHTML = replyHtml(reply);
    list.appendChild(wrap.firstElementChild);
    list.scrollTop = list.scrollHeight;
  }
  if (questionData) {
    questionData.reply_count = (questionData.reply_count || 0) + 1;
    renderQuestionHeader(questionData);
  }
  return true;
}

function setupComposer() {
  const form = $("#question-reply-form");
  const input = $("#question-reply-input");
  const btn = $("#question-reply-send");
  if (!form || !input) return;

  const tryEnable = () => {
    const ready = !!hooks.getPosition?.();
    input.disabled = !ready;
    if (btn) btn.disabled = !ready || !(input.value || "").trim();
  };

  input.addEventListener("input", tryEnable);
  tryEnable();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = (input.value || "").trim();
    if (!text) return;
    if (btn) btn.disabled = true;
    const ok = await submitReply(text);
    if (ok) input.value = "";
    tryEnable();
  });
}

function startReplyPolling() {
  stopReplyPolling();
  replyPollTimer = setInterval(() => {
    if (document.visibilityState !== "hidden") loadReplies();
  }, 15000);
}

function stopReplyPolling() {
  if (replyPollTimer) {
    clearInterval(replyPollTimer);
    replyPollTimer = null;
  }
}

export function showQuestionPage() {
  $("#map-screen")?.setAttribute("hidden", "hidden");
  $("#question-screen")?.removeAttribute("hidden");
  $("#chat-panel")?.setAttribute("hidden", "hidden");
  $("#chat-composer")?.setAttribute("hidden", "hidden");
  $("#question-composer")?.removeAttribute("hidden");
  document.getElementById("chat-app")?.classList.remove("chat-app--home", "chat-app--room");
  document.getElementById("chat-app")?.classList.add("chat-app--question");
}

export async function initQuestionPage(callbacks) {
  hooks = callbacks;
  if (!hooks.getQuestionId?.()) return;

  showQuestionPage();
  setupComposer();

  try {
    if (!hooks.getPosition?.()) await hooks.ensureLocation?.();
    await loadQuestion();
    await loadReplies();
    startReplyPolling();

    const input = $("#question-reply-input");
    const btn = $("#question-reply-send");
    if (input) input.disabled = false;
    if (btn) btn.disabled = !(input?.value || "").trim();
  } catch {
    const placeholder = $("#question-replies-placeholder");
    if (placeholder) {
      placeholder.hidden = false;
      const p = placeholder.querySelector(".state-text");
      if (p) p.textContent = "Could not load this question.";
    }
  }
}

export function teardownQuestionPage() {
  stopReplyPolling();
}

export { questionHref };
