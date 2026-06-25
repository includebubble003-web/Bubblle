/** Visual-only title → emoji mapping for community & question cards. */

const TOPIC_RULES = [
  [/book|read|literature|novel|library/i, "📚"],
  [/software|engineer|dev|code|tech|program|developer|startup/i, "💻"],
  [/coffee|caf[eé]|wfh|remote work|espresso|latte/i, "☕"],
  [/fitness|gym|workout|health|yoga|run|running|exercise/i, "🏋"],
  [/food|foodie|biryani|restaurant|eat|dining|street food|snack/i, "🍜"],
  [/chicken|non.?veg|meat|grill/i, "🍗"],
  [/movie|film|cinema|watch/i, "🎬"],
  [/music|concert|band|song/i, "🎵"],
  [/travel|trip|tourist|visit|explore/i, "✈️"],
  [/pet|dog|cat|animal/i, "🐾"],
  [/photo|camera|photography/i, "📷"],
  [/game|gaming|gamer|playstation|xbox/i, "🎮"],
  [/study|student|exam|college|university|school/i, "📖"],
  [/shop|market|mall|buy|store/i, "🛍"],
  [/bike|motor|vehicle|car|drive|parking/i, "🚗"],
  [/doctor|medical|healthcare|hospital|clinic/i, "🏥"],
  [/park|garden|nature|outdoor|trek|hike/i, "🌿"],
  [/night|party|club|bar|drink/i, "🌙"],
  [/home|rent|flat|apartment|housing|pg\b/i, "🏠"],
  [/wifi|internet|network|broadband/i, "📶"],
  [/affordable|cheap|budget|price|cost/i, "💰"],
  [/best|recommend|top|favorite|favourite/i, "⭐"],
  [/nearby|near|local|around|area/i, "📍"],
];

const DEFAULT_COMMUNITY = "👥";
const DEFAULT_QUESTION = "💬";

export function topicIcon(title, { kind = "community" } = {}) {
  const fallback = kind === "question" ? DEFAULT_QUESTION : DEFAULT_COMMUNITY;
  if (!title || typeof title !== "string") return fallback;
  for (const [pattern, emoji] of TOPIC_RULES) {
    if (pattern.test(title)) return emoji;
  }
  return fallback;
}
