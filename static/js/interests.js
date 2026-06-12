/**
 * First-visit interest selection + bubble recommendation scoring.
 */
import { activeUsers } from "./bubble-sync.js";
import { safeGetItem, safeSetItem } from "./client-state.js";

export const INTERESTS_KEY = "bbl_user_interests";
export const INTERESTS_SKIPPED_KEY = "bbl_interests_skipped";
export const MAX_INTERESTS = 5;

export const INTEREST_OPTIONS = [
  {
    id: "technology",
    label: "Technology",
    keywords: ["software", "engineer", "engineers", "tech", "coding", "developer", "sde", "programmer", "iit", "nit"],
  },
  {
    id: "startups",
    label: "Startups",
    keywords: ["startup", "founder", "founders"],
  },
  {
    id: "books",
    label: "Books",
    keywords: ["book", "books", "worm", "worms", "reading", "reader", "novel"],
  },
  {
    id: "fitness",
    label: "Fitness",
    keywords: ["fitness", "gym", "workout", "run", "running", "health"],
  },
  {
    id: "travel",
    label: "Travel",
    keywords: ["travel", "traveler", "trek", "trekking", "trip", "weekend"],
  },
  {
    id: "movies",
    label: "Movies",
    keywords: ["movie", "movies", "buff", "buffs", "bollywood", "hollywood", "cinema", "ott"],
  },
  {
    id: "cricket",
    label: "Cricket",
    keywords: ["cricket", "ipl", "bat", "ball", "wicket"],
  },
  {
    id: "anime",
    label: "Anime",
    keywords: ["anime", "manga", "otaku"],
  },
  {
    id: "food",
    label: "Food",
    keywords: ["food", "cafe", "coffee", "chai", "espresso", "street", "restaurant", "lunch", "dinner", "conversations"],
  },
  {
    id: "career",
    label: "Career",
    keywords: ["career", "aspirant", "aspirants", "placement", "intern", "job", "jee", "iit", "nit", "engineer"],
  },
];

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getUserInterests() {
  try {
    const raw = safeGetItem(INTERESTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = new Set(INTEREST_OPTIONS.map((o) => o.id));
    return parsed.filter((id) => valid.has(id)).slice(0, MAX_INTERESTS);
  } catch {
    return [];
  }
}

export function saveUserInterests(ids) {
  const valid = new Set(INTEREST_OPTIONS.map((o) => o.id));
  const clean = [...new Set(ids.filter((id) => valid.has(id)))].slice(0, MAX_INTERESTS);
  safeSetItem(INTERESTS_KEY, JSON.stringify(clean));
  safeSetItem(INTERESTS_SKIPPED_KEY, "");
  return clean;
}

export function markInterestsSkipped() {
  safeSetItem(INTERESTS_SKIPPED_KEY, "1");
}

export function hasInterestProfile() {
  if (safeGetItem(INTERESTS_SKIPPED_KEY) === "1") return true;
  return getUserInterests().length > 0;
}

export function canShowRecommendations() {
  return getUserInterests().length > 0;
}

export function interestMatchCount(title, interestIds) {
  const haystack = normalize(title);
  if (!haystack || !interestIds.length) return 0;
  let hits = 0;
  for (const id of interestIds) {
    const option = INTEREST_OPTIONS.find((o) => o.id === id);
    if (!option) continue;
    if (option.keywords.some((kw) => haystack.includes(kw))) hits += 1;
  }
  return hits;
}

export function recommendationScore(bubble, interestIds) {
  const matches = interestMatchCount(bubble.title, interestIds);
  const interestScore = matches * 100;
  const dist = Number(bubble.distance_m);
  const distanceScore = Number.isFinite(dist)
    ? Math.max(0, 150 - dist / 50)
    : 0;
  const activityScore = activeUsers(bubble) * 8;
  return interestScore + distanceScore + activityScore;
}

export function rankRecommendedBubbles(bubbles, interestIds, limit = 8) {
  if (!interestIds.length || !bubbles.length) return [];

  const scored = bubbles
    .map((bubble) => ({
      bubble,
      matches: interestMatchCount(bubble.title, interestIds),
    }))
    .filter((row) => row.matches > 0)
    .sort((a, b) => {
      if (b.matches !== a.matches) return b.matches - a.matches;
      const distA = a.bubble.distance_m ?? Infinity;
      const distB = b.bubble.distance_m ?? Infinity;
      if (distA !== distB) return distA - distB;
      return activeUsers(b.bubble) - activeUsers(a.bubble);
    });

  return scored.slice(0, limit).map((row) => row.bubble);
}
