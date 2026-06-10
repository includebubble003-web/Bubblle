"""Shared demo bubble titles, personas, and AI topic hints."""

DEFAULT_LAT = 20.96
DEFAULT_LNG = 77.768

BUBBLE_TITLES = [
    "Best chai & coffee in town ☕",
    "Night hangout spots 🌙",
    "Weekend plan kya hai?",
    "Street food recommendations 🌮",
    "Bakwas lunch rant 😤",
]

LEGACY_DEMO_TITLES = [
    "Late night chai & baatein ☕",
    "Andheri metro crowd 🚇",
    "Best street food near me 🌮",
    "Internship / placement gyaan",
]

ALL_DEMO_TITLES = BUBBLE_TITLES + LEGACY_DEMO_TITLES

USER_POOLS = [
    ["ChaiLover", "FilterFan", "CuttingChai", "ColdBrew", "MasalaGirl", "IraniCafe", "OfficeChai", "LatteArt", "GingerTea", "EspressoBro"],
    ["NightOwl", "AfterHours", "MarineDrive", "RooftopGuy", "LiveMusic", "SafeSolo", "2amHungry", "ClubNoob", "WalkTalk", "StarGazer"],
    ["WeekendKing", "BrunchQueen", "Trekker", "MovieBuff", "Homebody", "Foodie", "BudgetTravel", "PoolParty", "Sleepyhead", "Spontaneous"],
    ["PavBhaji", "Momos4Life", "ChaatLover", "VadaPav", "DosaKing", "KebabFan", "SweetTooth", "SpiceLevel", "VegOnly", "MidnightBiryani"],
    ["CanteenVictim", "TiffinFail", "MaggiForever", "SaladSad", "HRlunch", "WfhEater", "SkipLunch", "Cafeteria", "HangryDev", "MealPrep"],
]

# Short topic line for AI system prompts (index matches BUBBLE_TITLES)
TOPIC_PROMPTS = [
    "finding the best chai and coffee in town — tapri vs cafe, cutting chai, filter coffee",
    "night hangout spots — safe late-night places, Marine Drive, food after midnight",
    "weekend plans — trips, brunch, movies, treks, budget ideas",
    "street food — vada pav, chaat, momos, hygiene tips, best stalls",
    "complaining about bad office/canteen lunch — bakwas khana, tiffin fails, maggi survival",
]

DEMO_ONLINE_COUNT = 10

# (speaker_index, message) per bubble — Hindi/English mix
CONVERSATIONS = [
    [
        (0, "Guys serious debate — best cutting chai in town kahan milti hai?"),
        (1, "Filter coffee South Indian joints pe jeet jaati hai, chai ke liye tapri."),
        (2, "Tapri near station — adrak strong, half cup ₹10. Peak."),
        (3, "Coffee mein Blue Tokai ya local roastery try ki hai kisi ne?"),
        (4, "Local roastery better value. Blue Tokai weekend queue nightmare."),
        (5, "Masala chai vs normal chai — kitna masala is too much?"),
        (6, "Elaichi overdose = perfume cup 😂 thoda hi sahi."),
        (7, "Genuine question: chai bag wali ya fresh patti — taste difference real?"),
        (8, "Fresh patti always. Bag wali office emergency only."),
        (9, "Cold coffee summer mein bhi chai peete ho ya switch?"),
        (0, "Switch nahi — cutting chai garam hi chahiye year round."),
        (1, "Irani cafe bun maska + chai combo — underrated?"),
        (2, "Highly underrated. Breakfast of champions."),
        (3, "Best coffee under ₹150? Student budget friendly."),
        (4, "Cappuccino at small cafes — ask for double shot, still cheap."),
        (5, "Chai pe charcha — do you judge people by tea vs coffee team?"),
        (6, "Nahi yaar, dono valid. Main dono peeta hun."),
        (7, "Night shift — chai kitni cup max? Meri record 7 hai 💀"),
        (8, "After 4 I get anxiety. Green tea switch karo."),
        (9, "Okay vote: tapri chai > fancy cafe?"),
        (0, "Tapri for soul. Cafe for laptop and WiFi."),
        (1, "Thanks — ab chai peene ja raha hun, recommendations solid thi ✌️"),
    ],
    [
        (0, "Aaj raat kahan hangout kar sakte hain? Safe + fun chahiye."),
        (1, "Marine Drive walk — free, open, couples + friends dono."),
        (2, "Rooftop cafe after 10 — vibe achhi but pricey."),
        (3, "Solo jaana safe hai kya late night? Genuine question."),
        (4, "Crowded public spots OK. Empty lanes avoid. Share live location."),
        (5, "Best time for night drive — 11 pm ya 1 am?"),
        (6, "11 pm traffic kam. 1 am feels cinematic but sleepy drivers."),
        (7, "Live music wala spot koi batao is week."),
        (8, "Check Instagram stories of local bars — guest list scene."),
        (9, "Food after midnight — kya open rehta hai seriously?"),
        (0, "Shawarma spots, some McD 24h, and the legendary anda pav stall."),
        (1, "Club jaana hai first time — entry scene kaisa hota hai?"),
        (2, "Cover charge + ID. Prebook if popular night."),
        (3, "Budget hangout under ₹500 per person — ideas?"),
        (4, "Beach + street food + auto ride. Done."),
        (5, "Late night chai tapri pe baith ke gossip > club any day."),
        (6, "Star gazing spot outskirts pe — worth the drive?"),
        (7, "Haan if weather clear. Mosquito repellent le lena 😅"),
        (8, "Curfew ya police hassle hota hai kya area mein?"),
        (9, "Generally fine if not creating noise. Respect locals."),
        (0, "Plan set — Marine Drive 10:30, phir cutting chai. Who's in?"),
        (1, "In. Late night gang assemble 🌙"),
    ],
    [
        (0, "Weekend plan kya hai sabka? Main abhi bhi clueless."),
        (1, "Saturday trek, Sunday lazy + laundry. Classic."),
        (2, "Friend ne Goa bol diya — budget kitna realistic for 2 days?"),
        (3, "₹5-8k per person if bus + hostel. Flight alag story."),
        (4, "Movie ya web series binge — theatre worth it?"),
        (5, "Theatre for big releases. OTT for comfort."),
        (6, "Day trip near city — Alibaug / Lonavala type?"),
        (7, "Ferry + beach = solid without burning leave."),
        (8, "House party vs going out — team kya?"),
        (9, "House party. Playlist + snacks split."),
        (0, "Brunch overrated hai ya worth it once a month?"),
        (1, "Worth it for catch-up. Photo tax included 😂"),
        (2, "Gym skip karke weekend full rest — guilty feel hota hai?"),
        (3, "Rest bhi recovery hai. Monday se phir."),
        (4, "Random: best Sunday market for cheap shopping?"),
        (5, "Local flea markets — bargain skills mandatory."),
        (6, "Family obligation vs friends plan — kaise balance?"),
        (7, "Half day family, half day friends. Negotiate 😅"),
        (8, "Main toh ghar pe gaming + biryani. Zero regrets."),
        (9, "Solid plans everyone — Monday update dena gossip ke liye!"),
        (0, "Done. Enjoy weekend all 🙌"),
    ],
    [
        (0, "Street food recommendations chahiye — veg + non-veg dono."),
        (1, "Vada pav near station — Mumbai religion."),
        (2, "Paneer tikka roll — underrated street gem."),
        (3, "Hygiene kaise judge karte ho stall pe? Genuine question."),
        (4, "Crowd + turnover + gloves/tongs. Busy stall usually fresher."),
        (5, "Momos steamed ya fried? Team?"),
        (6, "Steamed + red chutney. Fight me."),
        (7, "Best chaat — bhel ya pani puri?"),
        (8, "Pani puri live counter — entertainment + taste."),
        (9, "Budget ₹200 mein kya khana fill karega?"),
        (0, "Pav bhaji plate + soda. Done."),
        (1, "Late night street food safe hai?"),
        (2, "Busy areas OK. Odd empty stall at 3 am — skip."),
        (3, "Spice level 'medium' bolna — still fire milta hai 😭"),
        (4, "Bolta hai 'thoda kam mirchi' — vendor smiles and ignores."),
        (5, "Sweet ending — kulfi ya gola?"),
        (6, "Kulfi falooda if feeling fancy on street."),
        (7, "Which city has best street food overall? Fight in chat."),
        (8, "Delhi vs Mumbai vs Kolkata — all have cases."),
        (9, "I'm ordering pani puri. 6 plates. No regrets."),
        (0, "Legend. Report back taste review 🙏"),
    ],
    [
        (0, "Aaj ka lunch itna bakwas tha ki ab mood off hai 😤"),
        (1, "Same. Office canteen ne betray kar diya."),
        (2, "Kya mila? Dal pani jaisa ya dry roti?"),
        (3, "Soggy rice + mystery sabzi. Color suspicious."),
        (4, "Tiffin leak + taste fail — double trauma."),
        (5, "Genuine question: skip lunch or force eat bad food?"),
        (6, "Skip + 4 pm maggi. Survival mode."),
        (7, "Cafeteria 'special' pe trust mat karo — lesson learned."),
        (8, "WFH lunch = last night's leftover — better than canteen?"),
        (9, "Always. Canteen is roulette."),
        (0, "HR ne healthy salad push kiya — tastes like sadness."),
        (1, "Salad mein dressing bhi cheap. Double bakwas."),
        (2, "Best revenge — ghar pe achha dinner plan karo."),
        (3, "Swiggy order kiya compensatory biryani. No guilt."),
        (4, "Meal prep Sunday karta hun phir bhi Wednesday sad ho jata hai."),
        (5, "Sharing tiffin with colleague — risk ya bonding?"),
        (6, "Bonding until they take your last paratha."),
        (7, "School lunch nostalgia > adult lunch reality."),
        (8, "Adult lunch = meetings during chew. Rude."),
        (9, "Kal se tiffin ghar se. Declaration in chat for accountability."),
        (0, "Support group ban gaya ye bubble 😂 same guys tomorrow?"),
        (1, "Haan. Lunch rant daily thread chalega."),
    ],
]

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
