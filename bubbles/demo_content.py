"""Shared demo bubble titles, personas, and AI topic hints."""

from bubbles.demo_conversations import COMMUNITY_BUBBLES

DEFAULT_LAT = 20.96
DEFAULT_LNG = 77.768

BUBBLE_TITLES = [b["title"] for b in COMMUNITY_BUBBLES]

LEGACY_DEMO_TITLES = [
    "Best chai & coffee in town ☕",
    "Night hangout spots 🌙",
    "Weekend plan kya hai?",
    "Street food recommendations 🌮",
    "Bakwas lunch rant 😤",
    "Late night chai & baatein ☕",
    "Andheri metro crowd 🚇",
    "Best street food near me 🌮",
    "Internship / placement gyaan",
]

ALL_DEMO_TITLES = BUBBLE_TITLES + LEGACY_DEMO_TITLES

USER_POOLS = [b["users"] for b in COMMUNITY_BUBBLES]

TOPIC_PROMPTS = [b["topic"] for b in COMMUNITY_BUBBLES]

CONVERSATIONS = [b["messages"] for b in COMMUNITY_BUBBLES]

DEMO_ONLINE_COUNT = 6

# Pool for AI bots — 2 picked per bubble (deterministic by bubble id)
AI_PERSONA_POOL: list[str] = sorted(
    {name for pool in USER_POOLS for name in pool}
    | {
        "Rahul",
        "Priya",
        "Arjun",
        "Neha",
        "Vikram",
        "Ananya",
        "Rohan",
        "Kavya",
        "Amit",
        "Sneha",
        "Kabir",
        "Isha",
        "Nikhil",
        "Tanvi",
        "Aditya",
        "Shreya",
        "Manish",
        "Divya",
        "Karan",
        "Pooja",
    }
)


def topic_for_bubble(title: str) -> str:
    """Topic hint for OpenAI — demo titles get rich prompts, others use title."""
    if title in BUBBLE_TITLES:
        return TOPIC_PROMPTS[BUBBLE_TITLES.index(title)]
    return title


def pick_personas_for_bubble(bubble_id: str, count: int = 2) -> list[str]:
    """Stable pick of `count` names per bubble (same bubble → same bots)."""
    identities = pick_bot_identities(bubble_id, count)
    return [name for name, _ in identities]


# --- AI bot archetypes: each bubble gets a fixed persona type ---

AI_ARCHETYPE_KEYS = ("tharki_boy", "pakao_uncle", "genz_youth")

AI_ARCHETYPE_NAMES: dict[str, list[str]] = {
    "tharki_boy": ["Rohit", "Bunty", "Sunny", "Golu", "Monty", "Chintu", "Tinku"],
    "pakao_uncle": ["Sharma ji", "Gupta uncle", "Verma sahab", "Ramesh uncle", "Kulkarni ji"],
    "genz_youth": ["Aaru", "Dev", "Naina", "Zoya", "Veer", "Kiara", "Ishaan", "Myra"],
}

# Per-message mood — stops every reply sounding identical
REPLY_MOOD_HINTS = [
    "bilkul short — 1 line, 8-12 shabd max",
    "thoda sarcastic / witty",
    "agree karte hue, supportive vibe",
    "halka disagree — apni alag rai",
    "meme / joke energy, halka over-the-top",
    "casual reaction — jaise phone dekhte hue type kar raha ho",
    "thoda dramatic / filmy ek second ke liye",
    "seedha point — no fluff",
    "emoji use kar (1-2 max), warna mat",
    "question puch ke baat aage badha",
]


def pick_bot_identities(bubble_id: str, count: int = 1) -> list[tuple[str, str]]:
    """(display_name, archetype_key) — stable per bubble, archetypes rotate if count > 1."""
    ranked_arch = sorted(AI_ARCHETYPE_KEYS, key=lambda k: hash(f"{bubble_id}:arch:{k}"))
    out: list[tuple[str, str]] = []
    used_names: set[str] = set()
    for i in range(max(1, count)):
        arch = ranked_arch[i % len(ranked_arch)]
        names = AI_ARCHETYPE_NAMES[arch]
        ranked_names = sorted(names, key=lambda n: hash(f"{bubble_id}:{arch}:{n}"))
        name = next((n for n in ranked_names if n not in used_names), ranked_names[0])
        used_names.add(name)
        out.append((name, arch))
    return out


def mood_hint_for_message(bubble_id: str, bot_name: str, msg_id: str | None) -> str:
    key = f"{bubble_id}:{bot_name}:{msg_id or 'x'}"
    idx = hash(key) % len(REPLY_MOOD_HINTS)
    return REPLY_MOOD_HINTS[idx]


def build_archetype_system_prompt(
    name: str,
    topic: str,
    archetype: str,
    mood_hint: str,
) -> str:
    """Distinct voice per archetype — must not sound like generic chatbot."""
    common = (
        f"Naam: {name}. Group topic: {topic}. "
        f"Is message ke liye tone: {mood_hint}. "
        "Sirf Hindi (Devanagari). 1-2 chhote vakya. "
        "Kabhi mat bol: AI, assistant, language model, main madad kar sakta hoon. "
        "Har reply alag lagni chahiye — template ya same opening mat use kar. "
        "Pehle wale jawab repeat mat kar."
    )

    if archetype == "tharki_boy":
        return (
            f"Tu '{name}' hai — desi tharki ladka, group chat mein hamesha mauka dhoondh ke "
            "cheeky comment maarta hai. Flirt light hai, creepy ya vulgar explicit nahi. "
            "Style: 'arre yaar', 'bhai kasam', 'scene set hai', double meaning halka, "
            "food/girls/plans pe taang adaana, overconfident funny. "
            "Kabhi serious advice mat de. Uncle jaisa mat bol. GenZ slang mat use kar. "
            f"{common}\n"
            "Example vibe (copy mat kar): 'अरे यार ये तो सीन सेट है 😏' / 'भाई तू ना बहुत innocent है'"
        )

    if archetype == "pakao_uncle":
        return (
            f"Tu '{name}' hai — classic pakao uncle jisko har baat pe lecture dena hai. "
            "Style: 'hamare time mein', 'beta suno', 'tum log ka zamaana alag hai', "
            "unnecessary advice, dad joke, statistics ya purani yaadein, thoda boring lekin funny. "
            "GenZ slang mat use kar. Tharki jokes mat maar. "
            f"{common}\n"
            "Example vibe (copy mat kar): 'बेटा हमारे ज़माने में ऐसा नहीं होता था' / 'एक बात बताूँ...'"
        )

    if archetype == "genz_youth":
        return (
            f"Tu '{name}' hai — GenZ Indian youth, Roman Hindi + thodi English mix chalegi. "
            "Style: 'fr', 'no cap', 'vibe', 'literally', 'same', 'cringe', 'sus', "
            "short reactive text, ironic, memes reference, 💀😭 kabhi kabhi. "
            "Uncle lecture mat de. Tharki tone mat le. "
            f"{common}\n"
            "Example vibe (copy mat kar): 'literally same bro 💀' / 'ye vibe alag hai yaar'"
        )

    return (
        f"Tu '{name}' hai — normal desi group chat user. {common}"
    )


# --- Reusable conversation starters (no LLM needed for most activity) ---

STARTER_LIBRARY: dict[str, list[str]] = {
    "questions": [
        "Genuine question — kya try kiya tumne is area mein?",
        "Opinion poll: overrated ya underrated?",
        "Koi local hidden gem batao na 👀",
        "First time visitors ke liye ek tip?",
        "Budget friendly option kya hai realistically?",
        "Weekday vs weekend — kab jana better?",
        "Solo safe hai ya group chahiye?",
        "Best time of day to go?",
        "Veg options decent milte hain?",
        "Crowd ka scene kaisa rehta hai?",
    ],
    "jokes": [
        "Mood: hungry, broke, and hopeful — classic combo 😂",
        "Main yahan suggestions lene aaya, decisions lene nahi.",
        "GPS bol raha hai 'recalculating' — story of my life.",
        "Plan A fail, Plan B snack.",
        "Confidence: 100%. Planning: 0%.",
    ],
    "recommendations": [
        "Try the small stall with a queue — usually worth it.",
        "Skip the fancy place once, try the local spot.",
        "If spice level scary lag raha hai, 'medium' bolo 😅",
        "Cash handy rakho — some places UPI drama karte hain.",
        "Evening time vibe alag hota hai, worth checking.",
    ],
    "polls": [
        "Team A or Team B? Comment below.",
        "Vote: cheap & good vs fancy & pricey?",
        "Chai team ☕ vs coffee team?",
        "Indoor chill vs outdoor walk?",
        "Street food vs sit-down restaurant?",
    ],
    "icebreakers": [
        "Anyone around here right now?",
        "Room quiet hai — koi alive hai? 😄",
        "Drop one rec, I'll try this week.",
        "New here — what's good nearby?",
        "Late night thoughts thread 🌙",
        "Quick rant: what's overrated in this city?",
        "Good news / bad news — go.",
        "What brought you to this bubble?",
    ],
}


def remix_conversation_lines(bubble_index: int, count: int) -> list[str]:
    """Pull and lightly shuffle lines from the demo script + starter library."""
    import random

    rng = random.Random(f"remix:{bubble_index}")
    script = CONVERSATIONS[bubble_index % len(CONVERSATIONS)]
    lines = [text for _, text in script]
    for items in STARTER_LIBRARY.values():
        lines.extend(items)
    rng.shuffle(lines)
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        if line in seen:
            continue
        seen.add(line)
        out.append(line)
        if len(out) >= count:
            break
    return out


def pick_cycle_authors(bubble_id: str, users: list[str], count: int) -> list[str]:
    """Scheduled lines use the AI persona so they don't block human-quiet detection."""
    bot_name = pick_bot_identities(bubble_id, 1)[0][0]
    return [bot_name] * count
