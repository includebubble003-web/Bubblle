"""
Seed 5 demo bubbles with 10 users each and realistic Hindi/English chat.

Usage:
  python manage.py seed_demo_chat
  python manage.py seed_demo_chat --lat 19.076 --lng 72.8777
  python manage.py seed_demo_chat --clear
  docker compose exec web python manage.py seed_demo_chat
"""
from __future__ import annotations

import random
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from bubbles.demo_content import (
    ALL_DEMO_TITLES,
    BUBBLE_TITLES,
    CONVERSATIONS,
    DEFAULT_LAT,
    DEFAULT_LNG,
    DEMO_ONLINE_COUNT,
    USER_POOLS,
)
from bubbles.membership import membership_seed_demo
from bubbles.models import Bubble, Message


class Command(BaseCommand):
    help = "Create 5 demo bubbles with 10 users each and Hindi/English sample chat."

    def add_arguments(self, parser):
        parser.add_argument(
            "--lat",
            type=float,
            default=DEFAULT_LAT,
            help=f"Bubble center latitude (default {DEFAULT_LAT})",
        )
        parser.add_argument(
            "--lng",
            type=float,
            default=DEFAULT_LNG,
            help=f"Bubble center longitude (default {DEFAULT_LNG})",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete previously seeded demo bubbles before seeding.",
        )
        parser.add_argument(
            "--offset-km",
            type=float,
            default=0.3,
            help="Spread bubbles apart by ~km so they don't stack (default 0.3).",
        )
        parser.add_argument(
            "--no-fake-online",
            action="store_true",
            help="Skip seeding Redis active user count (default: show 10 online).",
        )
        parser.add_argument(
            "--expires-hours",
            type=float,
            default=None,
            help="Bubble lifetime in hours (default: BUBBLLE_DEMO_EXPIRES_SECONDS, usually 24h).",
        )

    def handle(self, *args, **options):
        lat = options["lat"]
        lng = options["lng"]
        offset_km = options["offset_km"]
        seed_online = not options["no_fake_online"]

        if options["clear"]:
            deleted = self._clear_demo_bubbles()
            self.stdout.write(self.style.WARNING(f"Cleared {deleted} existing demo bubble(s)."))

        radius = int(getattr(settings, "BUBBLLE_DEFAULT_RADIUS_M", 5000))
        if options["expires_hours"] is not None:
            expires_seconds = int(options["expires_hours"] * 3600)
        else:
            expires_seconds = int(
                getattr(settings, "BUBBLLE_DEMO_EXPIRES_SECONDS", 24 * 60 * 60)
            )
        expires_at = timezone.now() + timedelta(seconds=expires_seconds)

        created_bubbles = []
        total_messages = 0

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
            msg_count = self._seed_messages(bubble, users, script)
            total_messages += msg_count

            online = 0
            if seed_online:
                online = membership_seed_demo(bubble.id, count=DEMO_ONLINE_COUNT)

            created_bubbles.append((bubble, users, msg_count, online))

            self.stdout.write(
                self.style.SUCCESS(
                    f"  [{i + 1}/5] {title}\n"
                    f"         id={bubble.id}\n"
                    f"         users={len(users)}, messages={msg_count}, active={online}\n"
                    f"         lat={bubble.latitude:.4f}, lng={bubble.longitude:.4f}"
                )
            )

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Demo seed complete."))
        self.stdout.write(f"  Bubbles: {len(created_bubbles)}")
        self.stdout.write(f"  Messages: {total_messages}")
        self.stdout.write("")
        self.stdout.write("Optional — live AI replies when someone chats:")
        self.stdout.write("  export OPENAI_API_KEY=sk-...")
        self.stdout.write("  python manage.py run_ai_chat_agents")
        self.stdout.write("")
        self.stdout.write("Open the app (same lat/lng as seed):")
        self.stdout.write(f"  http://localhost:8000/")
        self.stdout.write(f"  Manual location: {lat}, {lng}")
        self.stdout.write("")
        for bubble, _, _, _ in created_bubbles:
            self.stdout.write(f"  http://localhost:8000/bubble/{bubble.id}/")

    def _clear_demo_bubbles(self) -> int:
        qs = Bubble.objects.filter(title__in=ALL_DEMO_TITLES)
        count = qs.count()
        qs.delete()
        return count

    def _seed_messages(self, bubble: Bubble, users: list[str], script: list[tuple[int, str]]) -> int:
        now = timezone.now()
        reply_targets: list[Message] = []
        count = 0

        for idx, (speaker_idx, text) in enumerate(script):
            author = users[speaker_idx % len(users)]
            created_at = now - timedelta(minutes=(len(script) - idx) * random.randint(2, 5))

            reply_to = None
            if reply_targets and random.random() < 0.25:
                reply_to = random.choice(reply_targets[-4:])

            msg = Message.objects.create(
                bubble=bubble,
                anonymous_name=author,
                message=text,
                reply_to=reply_to,
            )
            Message.objects.filter(pk=msg.pk).update(created_at=created_at)
            reply_targets.append(msg)
            count += 1

        return count
