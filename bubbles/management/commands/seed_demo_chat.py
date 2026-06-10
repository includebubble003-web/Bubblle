"""
Seed demo bubbles with cost-conscious activity:
  - A few recent messages so rooms look alive
  - A scheduled batch (library remix, no LLM) released gradually by ai-agents
  - Optional one OpenAI batch per bubble via --openai-batch

Usage:
  python manage.py seed_demo_chat
  python manage.py seed_demo_chat --clear
  python manage.py seed_demo_chat --openai-batch
  docker compose exec web python manage.py seed_demo_chat --clear
"""
from __future__ import annotations

import asyncio
import random
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from bubbles.ai_activity import generate_openai_batch, queue_scheduled_messages
from bubbles.demo_content import (
    ALL_DEMO_TITLES,
    BUBBLE_TITLES,
    CONVERSATIONS,
    DEFAULT_LAT,
    DEFAULT_LNG,
    DEMO_ONLINE_COUNT,
    USER_POOLS,
    pick_cycle_authors,
    remix_conversation_lines,
)
from bubbles.membership import membership_seed_demo
from bubbles.models import Bubble, Message, ScheduledMessage


class Command(BaseCommand):
    help = (
        "Create demo bubbles with recent chat + scheduled message batches "
        "(5-20 msgs/day, no continuous AI spam)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--lat", type=float, default=DEFAULT_LAT)
        parser.add_argument("--lng", type=float, default=DEFAULT_LNG)
        parser.add_argument("--clear", action="store_true")
        parser.add_argument("--clear-only", action="store_true")
        parser.add_argument("--offset-km", type=float, default=0.3)
        parser.add_argument(
            "--no-fake-online",
            action="store_true",
            help="Skip seeding Redis active user count.",
        )
        parser.add_argument("--expires-hours", type=float, default=None)
        parser.add_argument(
            "--initial-messages",
            type=int,
            default=None,
            help="Recent visible messages per bubble (default: BUBBLLE_AI_SEED_INITIAL_MESSAGES).",
        )
        parser.add_argument(
            "--scheduled-messages",
            type=int,
            default=None,
            help="Queued gradual messages per bubble (default: BUBBLLE_AI_SEED_SCHEDULED_MESSAGES).",
        )
        parser.add_argument(
            "--openai-batch",
            action="store_true",
            help="One OpenAI call per bubble to fill the scheduled queue (otherwise library remix).",
        )

    def handle(self, *args, **options):
        lat = options["lat"]
        lng = options["lng"]
        offset_km = options["offset_km"]
        seed_online = not options["no_fake_online"]
        initial_n = options["initial_messages"] or int(
            getattr(settings, "BUBBLLE_AI_SEED_INITIAL_MESSAGES", 5)
        )
        scheduled_n = options["scheduled_messages"] or int(
            getattr(settings, "BUBBLLE_AI_SEED_SCHEDULED_MESSAGES", 18)
        )

        if options["clear"] or options["clear_only"]:
            deleted = self._clear_demo_bubbles()
            self.stdout.write(self.style.WARNING(f"Cleared {deleted} existing demo bubble(s)."))
            if options["clear_only"]:
                self.stdout.write(self.style.SUCCESS("Done (no new bubbles created)."))
                return

        if options["openai_batch"] and not self._openai_configured():
            self.stdout.write(
                self.style.ERROR("OPENAI_API_KEY required for --openai-batch.")
            )
            return

        radius = int(getattr(settings, "BUBBLLE_DEFAULT_RADIUS_M", 5000))
        if options["expires_hours"] is not None:
            expires_seconds = int(options["expires_hours"] * 3600)
        else:
            expires_seconds = int(
                getattr(settings, "BUBBLLE_DEMO_EXPIRES_SECONDS", 23 * 60)
            )
        expires_at = timezone.now() + timedelta(seconds=expires_seconds)

        created_bubbles = []
        total_initial = 0
        total_scheduled = 0

        for i, title in enumerate(BUBBLE_TITLES):
            dlat = (i - 2) * (offset_km / 111.0)
            dlng = (i % 2) * (offset_km / (111.0 * max(0.5, abs(lat) / 90)))

            bubble = Bubble.objects.create(
                title=title,
                latitude=lat + dlat,
                longitude=lng + dlng,
                radius=radius,
                expires_at=expires_at,
                active=True,
            )
            users = USER_POOLS[i]
            script = CONVERSATIONS[i]

            initial = self._seed_initial_messages(bubble, users, script, initial_n)
            total_initial += initial

            scheduled = self._seed_scheduled_batch(
                bubble,
                users,
                bubble_index=i,
                count=scheduled_n,
                use_openai=options["openai_batch"],
            )
            total_scheduled += scheduled

            online = 0
            if seed_online:
                online = membership_seed_demo(bubble.id, count=DEMO_ONLINE_COUNT)

            created_bubbles.append((bubble, initial, scheduled, online))

            self.stdout.write(
                self.style.SUCCESS(
                    f"  [{i + 1}/5] {title}\n"
                    f"         id={bubble.id}\n"
                    f"         initial={initial}, scheduled={scheduled}, fake_online={online}\n"
                    f"         lat={bubble.latitude:.4f}, lng={bubble.longitude:.4f}"
                )
            )

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Demo seed complete (cost-control mode)."))
        self.stdout.write(f"  Bubbles: {len(created_bubbles)}")
        self.stdout.write(f"  Initial messages (recent): {total_initial}")
        self.stdout.write(f"  Scheduled queue: {total_scheduled}")
        self.stdout.write("")
        self.stdout.write("Activity rules:")
        self.stdout.write("  • Scheduled lines release only after 3-10 min quiet")
        self.stdout.write("  • 1-3 messages per activation, then silent again")
        self.stdout.write("  • Pauses when real users chat (last 5 min)")
        self.stdout.write("  • Max 20 AI msgs/bubble/day, 200 platform/day")
        self.stdout.write("")
        self.stdout.write("Run the scheduler (releases queued messages):")
        self.stdout.write("  docker compose up -d ai-agents")
        self.stdout.write("")
        self.stdout.write(f"Open app near lat/lng: {lat}, {lng}")
        for bubble, _, _, _ in created_bubbles:
            self.stdout.write(f"  /bubble/{bubble.id}/")

    @staticmethod
    def _openai_configured() -> bool:
        import os

        return bool(
            (getattr(settings, "OPENAI_API_KEY", "") or os.environ.get("OPENAI_API_KEY", "")).strip()
        )

    def _clear_demo_bubbles(self) -> int:
        qs = Bubble.objects.filter(title__in=ALL_DEMO_TITLES)
        count = qs.count()
        qs.delete()
        return count

    def _seed_initial_messages(
        self,
        bubble: Bubble,
        users: list[str],
        script: list[tuple[int, str]],
        count: int,
    ) -> int:
        """Few recent lines so the room looks alive — not a full script dump."""
        now = timezone.now()
        take = min(count, len(script))
        start_idx = max(0, len(script) - take)
        slice_ = script[start_idx:]

        for offset, (speaker_idx, text) in enumerate(slice_):
            author = users[speaker_idx % len(users)]
            minutes_ago = (len(slice_) - offset) * random.randint(3, 8) + random.randint(5, 25)
            created_at = now - timedelta(minutes=minutes_ago)
            msg = Message.objects.create(
                bubble=bubble,
                anonymous_name=author,
                message=text,
            )
            Message.objects.filter(pk=msg.pk).update(created_at=created_at)
        return take

    def _seed_scheduled_batch(
        self,
        bubble: Bubble,
        users: list[str],
        *,
        bubble_index: int,
        count: int,
        use_openai: bool,
    ) -> int:
        lines: list[tuple[str, str]] = []

        if use_openai:
            try:
                raw = asyncio.run(
                    generate_openai_batch(
                        bubble.title,
                        str(bubble.id),
                        size=min(count, int(getattr(settings, "BUBBLLE_AI_BATCH_GENERATE_SIZE", 30))),
                    )
                )
                lines = raw[:count]
            except Exception as exc:
                self.stdout.write(
                    self.style.WARNING(f"OpenAI batch failed for {bubble.title}: {exc} — using library.")
                )

        if not lines:
            texts = remix_conversation_lines(bubble_index, count)
            authors = pick_cycle_authors(str(bubble.id), users, len(texts))
            lines = list(zip(authors, texts, strict=True))

        # First release after a quiet window (not immediately)
        start = timezone.now() + timedelta(
            minutes=random.randint(
                int(getattr(settings, "BUBBLLE_AI_INACTIVE_MIN_MINUTES", 3)),
                int(getattr(settings, "BUBBLLE_AI_INACTIVE_MAX_MINUTES", 10)),
            )
        )
        batch_id = queue_scheduled_messages(
            bubble,
            lines,
            start=start,
            batch_id=uuid.uuid4(),
            is_ai_generated=use_openai,
        )
        self.stdout.write(f"         batch {str(batch_id)[:8]}… queued {len(lines)} lines")
        return len(lines)
