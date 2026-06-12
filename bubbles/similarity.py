"""Bubble title similarity for duplicate / fragmentation detection."""
from __future__ import annotations

import re

_STOP_WORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "and",
        "or",
        "for",
        "in",
        "at",
        "to",
        "of",
        "on",
        "near",
        "nearby",
        "me",
        "my",
        "our",
        "your",
        "chat",
        "group",
        "bubble",
        "community",
        "communities",
        "lovers",
        "fans",
        "freaks",
        "buffs",
        "worms",
    }
)

_SYNONYM_GROUPS: tuple[frozenset[str], ...] = (
    frozenset(
        {
            "sde",
            "software",
            "engineer",
            "engineers",
            "developer",
            "developers",
            "dev",
            "devs",
            "coding",
            "programmer",
            "programmers",
            "tech",
            "code",
            "coder",
            "coders",
            "it",
        }
    ),
    frozenset({"wfh", "remote", "hybrid", "workfromhome"}),
    frozenset({"fitness", "gym", "workout", "health", "running", "runners", "run"}),
    frozenset({"book", "books", "reading", "readers", "novel", "novels", "reader"}),
    frozenset({"startup", "founder", "founders"}),
    frozenset({"movie", "movies", "film", "films", "cinema", "bollywood", "hollywood", "ott"}),
    frozenset({"travel", "traveler", "travelers", "traveller", "travellers", "trip", "trek", "trekking"}),
    frozenset({"cricket", "ipl", "batting", "bowling"}),
    frozenset({"anime", "manga", "otaku"}),
    frozenset({"coffee", "cafe", "café", "chai", "espresso"}),
    frozenset({"jee", "iit", "nit", "aspirant", "aspirants", "placement"}),
)


def normalize_title(text: str) -> str:
    t = text.lower().strip()
    t = re.sub(r"[^\w\s]", " ", t, flags=re.UNICODE)
    return re.sub(r"\s+", " ", t).strip()


def title_tokens(text: str) -> list[str]:
    norm = normalize_title(text)
    if not norm:
        return []
    return [w for w in norm.split() if w and w not in _STOP_WORDS and len(w) >= 2]


def _token_groups(token: str) -> set[int]:
    return {i for i, group in enumerate(_SYNONYM_GROUPS) if token in group}


def similar_bubble_score(query: str, title: str) -> float:
    """Higher score = stronger match. Zero means not similar enough to show."""
    q_norm = normalize_title(query)
    t_norm = normalize_title(title)
    if not q_norm or not t_norm:
        return 0.0

    if q_norm == t_norm:
        return 100.0
    if q_norm in t_norm or t_norm in q_norm:
        return 88.0

    q_tokens = title_tokens(query)
    t_tokens = title_tokens(title)
    if not q_tokens:
        return 0.0

    score = 0.0
    matched_query_tokens = 0

    for qt in q_tokens:
        token_hit = False
        for tt in t_tokens:
            if qt == tt:
                score += 14
                token_hit = True
            elif len(qt) >= 3 and len(tt) >= 3 and (qt in tt or tt in qt):
                score += 10
                token_hit = True
            elif _token_groups(qt) & _token_groups(tt):
                score += 8
                token_hit = True
        if token_hit:
            matched_query_tokens += 1

    if matched_query_tokens == 0:
        return 0.0

    coverage = matched_query_tokens / len(q_tokens)
    score *= 0.5 + 0.5 * coverage
    return score


def is_similar_enough(score: float) -> bool:
    return score >= 6.0
