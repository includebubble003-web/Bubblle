/**
 * Question discussion page — premium Q&A experience.
 */
import {
  authorInitials,
  fmtQuestionActivity,
  fmtQuestionDistanceAway,
  fmtReplyCount,
  fmtReplyCountReplies,
  fmtTimeAgo,
  fmtTimeAgoLong,
  questionHref,
} from "./questions.js";

const API_FETCH = { credentials: "include", cache: "no-store" };
const MOBILE_ANSWER_MQ = "(max-width: 900px)";
const REPLY_MIN_LINES = 3;
const REPLY_MAX_LINES = 6;
const REPLY_LINE_HEIGHT_PX = 24;

let hooks = {};
let questionData = null;
let replyPollTimer = null;
let answerModeActive = false;
let answerBlurTimer = null;
let viewportHandler = null;

function isMobileAnswerLayout() {
  return window.matchMedia(MOBILE_ANSWER_MQ).matches;
}

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

function setLoading(loading) {
  $("#question-loading")?.toggleAttribute("hidden", !loading);
  if (loading) {
    $("#question-hero")?.setAttribute("hidden", "hidden");
    $("#question-answers-section")?.setAttribute("hidden", "hidden");
  }
}

function buildQuestionMetaLine(q) {
  const parts = [];
  const dist = fmtQuestionDistanceAway(q.distance_m);
  if (dist) parts.push(dist);
  parts.push(fmtReplyCountReplies(q.reply_count));
  const posted = fmtTimeAgoLong(q.created_at);
  if (posted) parts.push(posted);
  return parts.join(" • ");
}

function replyHtml(reply) {
  const initials = authorInitials(reply.anonymous_name);
  return `<article class="answer-card" data-reply-id="${escapeHtml(reply.id)}" role="listitem">
    <div class="answer-card-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
    <div class="answer-card-body">
      <header class="answer-card-header">
        <span class="answer-card-author">${escapeHtml(reply.anonymous_name)}</span>
        <time class="answer-card-time" datetime="${escapeHtml(reply.created_at)}">${escapeHtml(fmtTimeAgo(reply.created_at))}</time>
      </header>
      <div class="answer-card-text">${escapeHtml(reply.message)}</div>
    </div>
  </article>`;
}

function renderQuestionHeader(q) {
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
  if (authorEl) authorEl.textContent = q.anonymous_name || "Anonymous";

  const metaEl = $("#question-page-meta");
  if (metaEl) metaEl.textContent = buildQuestionMetaLine(q);

  const metricsEl = $("#question-answers-metrics");
  if (metricsEl) {
    const replies = fmtReplyCount(q.reply_count);
    const activity = fmtQuestionActivity(q.last_activity_at);
    metricsEl.textContent = activity ? `${replies} · ${activity}` : replies;
  }

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

  $("#question-hero")?.removeAttribute("hidden");
  $("#question-answers-section")?.removeAttribute("hidden");
}

function renderReplies(replies) {
  const list = $("#question-replies");
  const empty = $("#question-replies-empty");
  if (!list) return;

  if (!replies.length) {
    list.replaceChildren();
    empty?.removeAttribute("hidden");
    return;
  }

  empty?.setAttribute("hidden", "hidden");
  list.replaceChildren(
    ...replies.map((r) => {
      const wrap = document.createElement("div");
      wrap.innerHTML = replyHtml(r);
      return wrap.firstElementChild;
    }),
  );
}

function scrollToLatestReply({ smooth = false } = {}) {
  const scroll = $("#question-scroll");
  if (!scroll) return;
  scroll.scrollTo({ top: scroll.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

function setAnswerMode(active) {
  answerModeActive = active;
  $("#question-screen")?.classList.toggle("question-screen--answer-mode", active);
  applyViewportLayout();
  if (active) requestAnimationFrame(() => scrollToLatestReply());
}

function enterAnswerMode() {
  if (!isMobileAnswerLayout()) return;
  setAnswerMode(true);
}

function scheduleExitAnswerMode() {
  if (answerBlurTimer) clearTimeout(answerBlurTimer);
  answerBlurTimer = setTimeout(() => {
    answerBlurTimer = null;
    if (document.activeElement === $("#question-reply-input")) return;
    setAnswerMode(false);
  }, 120);
}

function keyboardInsetPx() {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));
}

function applyViewportLayout() {
  const screen = $("#question-screen");
  if (!screen) return;

  if (!isMobileAnswerLayout() || !answerModeActive) {
    screen.style.height = "";
    screen.style.transform = "";
    document.documentElement.style.removeProperty("--question-kb-inset");
    return;
  }

  const vv = window.visualViewport;
  if (!vv) return;

  const inset = keyboardInsetPx();
  document.documentElement.style.setProperty("--question-kb-inset", `${inset}px`);

  if (inset > 0) {
    screen.style.height = `${vv.height}px`;
    screen.style.transform = `translateY(${vv.offsetTop}px)`;
  } else {
    screen.style.height = "";
    screen.style.transform = "";
  }

  requestAnimationFrame(() => scrollToLatestReply());
}

function setupViewportListeners() {
  if (!window.visualViewport || viewportHandler) return;

  viewportHandler = () => {
    applyViewportLayout();
    if (answerModeActive && keyboardInsetPx() === 0) {
      if (document.activeElement !== $("#question-reply-input")) setAnswerMode(false);
    }
  };

  window.visualViewport.addEventListener("resize", viewportHandler);
  window.visualViewport.addEventListener("scroll", viewportHandler);
  window.addEventListener("resize", viewportHandler);
}

function teardownViewportListeners() {
  if (viewportHandler && window.visualViewport) {
    window.visualViewport.removeEventListener("resize", viewportHandler);
    window.visualViewport.removeEventListener("scroll", viewportHandler);
  }
  window.removeEventListener("resize", viewportHandler || (() => {}));
  viewportHandler = null;
  document.documentElement.style.removeProperty("--question-kb-inset");
  $("#question-screen")?.classList.remove("question-screen--answer-mode");
  const screen = $("#question-screen");
  if (screen) {
    screen.style.height = "";
    screen.style.transform = "";
  }
}

function autoResizeReplyInput() {
  const el = $("#question-reply-input");
  if (!el) return;
  el.style.height = "auto";
  const minH = REPLY_LINE_HEIGHT_PX * REPLY_MIN_LINES + 20;
  const maxH = REPLY_LINE_HEIGHT_PX * REPLY_MAX_LINES + 20;
  const next = Math.min(Math.max(el.scrollHeight, minH), maxH);
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
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
  const empty = $("#question-replies-empty");
  empty?.setAttribute("hidden", "hidden");
  if (list) {
    const wrap = document.createElement("div");
    wrap.innerHTML = replyHtml(reply);
    list.appendChild(wrap.firstElementChild);
    scrollToLatestReply({ smooth: true });
  }
  if (questionData) {
    questionData.reply_count = (questionData.reply_count || 0) + 1;
    questionData.last_activity_at = new Date().toISOString();
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
    autoResizeReplyInput();
  };

  input.addEventListener("input", tryEnable);
  input.addEventListener("focus", () => {
    if (answerBlurTimer) {
      clearTimeout(answerBlurTimer);
      answerBlurTimer = null;
    }
    enterAnswerMode();
  });
  input.addEventListener("blur", scheduleExitAnswerMode);
  btn?.addEventListener("mousedown", (e) => e.preventDefault());

  autoResizeReplyInput();
  tryEnable();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = (input.value || "").trim();
    if (!text) return;
    if (btn) btn.disabled = true;
    const ok = await submitReply(text);
    if (ok) {
      input.value = "";
      autoResizeReplyInput();
      scrollToLatestReply({ smooth: true });
    }
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
  if (isMobileAnswerLayout()) {
    $("#sidebar")?.setAttribute("hidden", "hidden");
    $("#drawer-backdrop")?.setAttribute("hidden", "hidden");
    document.body.classList.remove("drawer-open");
  }
  const app = document.getElementById("chat-app");
  app?.classList.remove("chat-app--home", "chat-app--room");
  app?.classList.add("chat-app--question");
}

export async function initQuestionPage(callbacks) {
  hooks = callbacks;
  if (!hooks.getQuestionId?.()) return;

  showQuestionPage();
  setLoading(true);
  setupComposer();
  setupViewportListeners();

  try {
    if (!hooks.getPosition?.()) await hooks.ensureLocation?.();
    await loadQuestion();
    await loadReplies();
    startReplyPolling();

    const input = $("#question-reply-input");
    const btn = $("#question-reply-send");
    if (input) {
      input.disabled = false;
      refreshQuestionComposer();
    }
    if (btn) btn.disabled = !(input?.value || "").trim();
  } catch {
    $("#question-loading")?.setAttribute("hidden", "hidden");
    $("#question-answers-section")?.removeAttribute("hidden");
    const empty = $("#question-replies-empty");
    if (empty) {
      empty.hidden = false;
      const title = empty.querySelector(".question-empty-title");
      const lead = empty.querySelector(".question-empty-lead");
      if (title) title.textContent = "Could not load question";
      if (lead) lead.textContent = "Check your connection and try again.";
    }
  } finally {
    setLoading(false);
  }
}

export function refreshQuestionComposer() {
  autoResizeReplyInput();
}

export function teardownQuestionPage() {
  stopReplyPolling();
  teardownViewportListeners();
  if (answerBlurTimer) {
    clearTimeout(answerBlurTimer);
    answerBlurTimer = null;
  }
  answerModeActive = false;
}

export { questionHref };
