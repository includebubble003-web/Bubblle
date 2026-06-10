"""
AI activity cost control: quotas, human-priority checks, scheduled message release.
"""
from __future__ import annotations

import json
import random
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from bubbles.demo_content import pick_bot_identities, topic_for_bubble
from bubbles.models import Bubble, Message, ScheduledMessage
from bubbles.services import broadcast_message


def _today() -> date:
    return timezone.localdate()


def _platform_daily_key(d: date | None = None) -> str:
    return f"ai:daily:platform:{(d or _today()).isoformat()}"


def _bubble_daily_key(bubble_id: str, d: date | None = None) -> str:
    return f"ai:daily:bubble:{bubble_id}:{(d or _today()).isoformat()}"


def ai_persona_names(bubble_id: str) -> set[str]:
    count = int(getattr(settings, "BUBBLLE_AI_BOTS_PER_BUBBLE", 1))
    return {name for name, _ in pick_bot_identities(str(bubble_id), count)}


def get_daily_ai_count(bubble_id: str | None = None) -> int:
    if bubble_id:
        return int(cache.get(_bubble_daily_key(bubble_id), 0) or 0)
    return int(cache.get(_platform_daily_key(), 0) or 0)


def increment_daily_ai_count(bubble_id: str, amount: int = 1) -> None:
    ttl = 60 * 60 * 26
    for key in (_platform_daily_key(), _bubble_daily_key(bubble_id)):
        try:
            cache.incr(key, amount)
        except ValueError:
            cache.set(key, amount, timeout=ttl)
        else:
            cache.touch(key, timeout=ttl)


def daily_quota_remaining(bubble_id: str) -> tuple[int, int]:
    """Returns (bubble_remaining, platform_remaining)."""
    bubble_max = int(getattr(settings, "BUBBLLE_AI_MAX_MESSAGES_PER_BUBBLE_DAY", 20))
    platform_max = int(getattr(settings, "BUBBLLE_AI_MAX_MESSAGES_PLATFORM_DAY", 200))
    bubble_rem = max(0, bubble_max - get_daily_ai_count(bubble_id))
    platform_rem = max(0, platform_max - get_daily_ai_count(None))
    return bubble_rem, platform_rem


def has_daily_quota(bubble_id: str, need: int = 1) -> bool:
    bubble_rem, platform_rem = daily_quota_remaining(bubble_id)
    return bubble_rem >= need and platform_rem >= need


def last_message_at(bubble_id: str) -> datetime | None:
    msg = (
        Message.objects.filter(bubble_id=bubble_id)
        .order_by("-created_at")
        .values_list("created_at", flat=True)
        .first()
    )
    return msg


def last_human_message_at(bubble_id: str) -> datetime | None:
    """Real users are anyone who is not the bubble's AI persona name."""
    personas = ai_persona_names(bubble_id)
    msg = (
        Message.objects.filter(bubble_id=bubble_id)
        .exclude(anonymous_name__in=personas)
        .order_by("-created_at")
        .values_list("created_at", flat=True)
        .first()
    )
    return msg


def human_recently_active(bubble_id: str, within_minutes: int | None = None) -> bool:
    within = within_minutes or int(getattr(settings, "BUBBLLE_AI_HUMAN_QUIET_MINUTES", 5))
    last = last_human_message_at(bubble_id)
    if not last:
        return False
    return timezone.now() - last < timedelta(minutes=within)


def bubble_inactive_minutes(bubble_id: str) -> float | None:
    last = last_message_at(bubble_id)
    if not last:
        return None
    return (timezone.now() - last).total_seconds() / 60.0


def should_activate_bubble(bubble_id: str) -> bool:
    """True when room is quiet enough for a scheduled activation cycle."""
    if human_recently_active(bubble_id):
        return False
    if not has_daily_quota(bubble_id):
        return False
    inactive = bubble_inactive_minutes(bubble_id)
    if inactive is None:
        return True
    min_m = int(getattr(settings, "BUBBLLE_AI_INACTIVE_MIN_MINUTES", 3))
    max_m = int(getattr(settings, "BUBBLLE_AI_INACTIVE_MAX_MINUTES", 10))
    return inactive >= min_m and inactive <= max_m * 6


def messages_per_cycle() -> int:
    lo = int(getattr(settings, "BUBBLLE_AI_MESSAGES_PER_CYCLE_MIN", 1))
    hi = int(getattr(settings, "BUBBLLE_AI_MESSAGES_PER_CYCLE_MAX", 3))
    return random.randint(lo, hi)


def pending_scheduled_count(bubble_id: str) -> int:
    return ScheduledMessage.objects.filter(
        bubble_id=bubble_id, released_at__isnull=True, release_at__lte=timezone.now()
    ).count()


def unreleased_scheduled_count(bubble_id: str) -> int:
    return ScheduledMessage.objects.filter(
        bubble_id=bubble_id, released_at__isnull=True
    ).count()


@transaction.atomic
def release_due_scheduled_messages(bubble_id: str, max_count: int | None = None) -> list[Message]:
    """Post queued lines whose release time has passed (human-quiet + quota checks)."""
    if human_recently_active(bubble_id):
        return []

    limit = max_count or messages_per_cycle()
    bubble_rem, platform_rem = daily_quota_remaining(bubble_id)
    limit = min(limit, bubble_rem, platform_rem)
    if limit <= 0:
        return []

    bubble = Bubble.objects.filter(id=bubble_id, active=True).first()
    if not bubble or not bubble.is_joinable():
        return []

    due = list(
        ScheduledMessage.objects.select_for_update(skip_locked=True)
        .filter(bubble_id=bubble_id, released_at__isnull=True, release_at__lte=timezone.now())
        .order_by("release_at", "order_in_batch")[:limit]
    )

    posted: list[Message] = []
    now = timezone.now()
    for row in due:
        if not has_daily_quota(bubble_id):
            break
        msg = Message.objects.create(
            bubble=bubble,
            anonymous_name=row.anonymous_name,
            message=row.message,
        )
        broadcast_message(bubble.id, msg)
        row.released_at = now
        row.save(update_fields=["released_at"])
        increment_daily_ai_count(str(bubble.id))
        posted.append(msg)
    return posted


def build_release_schedule(
    start: datetime,
    message_count: int,
    *,
    seed: str | None = None,
) -> list[datetime]:
    """
    Spread messages in activation cycles: 3-10 min gaps, 1-3 msgs per cycle.
    """
    rng = random.Random(seed or str(start.timestamp()))
    times: list[datetime] = []
    cursor = start
    remaining = message_count
    while remaining > 0:
        gap_min = rng.randint(
            int(getattr(settings, "BUBBLLE_AI_INACTIVE_MIN_MINUTES", 3)),
            int(getattr(settings, "BUBBLLE_AI_INACTIVE_MAX_MINUTES", 10)),
        )
        cursor += timedelta(minutes=gap_min)
        batch = min(remaining, rng.randint(1, 3))
        for i in range(batch):
            times.append(cursor + timedelta(seconds=i * rng.randint(8, 45)))
        remaining -= batch
    return times


def queue_scheduled_messages(
    bubble: Bubble,
    lines: list[tuple[str, str]],
    *,
    start: datetime | None = None,
    batch_id: uuid.UUID | None = None,
    is_ai_generated: bool = True,
) -> uuid.UUID:
    """Persist a batch of lines with gradual release times."""
    batch_id = batch_id or uuid.uuid4()
    start = start or timezone.now()
    release_times = build_release_schedule(start, len(lines), seed=str(bubble.id))
    rows = [
        ScheduledMessage(
            bubble=bubble,
            batch_id=batch_id,
            anonymous_name=author,
            message=text,
            release_at=release_at,
            is_ai_generated=is_ai_generated,
            order_in_batch=idx,
        )
        for idx, ((author, text), release_at) in enumerate(zip(lines, release_times, strict=True))
    ]
    ScheduledMessage.objects.bulk_create(rows)
    return batch_id


async def generate_openai_batch(
    bubble_title: str,
    bubble_id: str,
    *,
    size: int | None = None,
    model: str | None = None,
) -> list[tuple[str, str]]:
    """One API call → many lines for scheduling (not realtime spam)."""
    from openai import AsyncOpenAI

    import os

    api_key = (getattr(settings, "OPENAI_API_KEY", "") or os.environ.get("OPENAI_API_KEY", "")).strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    size = size or int(getattr(settings, "BUBBLLE_AI_BATCH_GENERATE_SIZE", 30))
    size = max(5, min(size, 50))
    bot_name = pick_bot_identities(bubble_id, 1)[0][0]
    topic = topic_for_bubble(bubble_title)

    client = AsyncOpenAI(api_key=api_key)
    prompt = (
        f"Generate {size} short Hindi/Hinglish group-chat lines for topic: {topic}. "
        f"Main speaker name: {bot_name}. Mix: questions, polls, jokes, recommendations, icebreakers. "
        "Purpose: revive a quiet local chat — NOT simulate a busy group. "
        "Each line unique, 1-2 sentences max. Return JSON array of objects "
        '{{"author":"name","text":"message"}} only.'
    )
    resp = await client.chat.completions.create(
        model=model or getattr(settings, "OPENAI_MODEL", "gpt-4o-mini"),
        messages=[
            {
                "role": "system",
                "content": "You write realistic Indian group chat starters. Output valid JSON only.",
            },
            {"role": "user", "content": prompt},
        ],
        max_tokens=2500,
        temperature=0.9,
    )
    raw = (resp.choices[0].message.content or "").strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    data = json.loads(raw)
    out: list[tuple[str, str]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        author = str(item.get("author") or bot_name).strip()[:64]
        text = str(item.get("text") or "").strip()
        if text:
            out.append((author, text[:500]))
    return out[:size]
