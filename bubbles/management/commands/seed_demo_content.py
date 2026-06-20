"""
Seed demo/onboarding content for product testing and new deployments.

Usage:
  python manage.py seed_demo_content
  python manage.py seed_demo_content --clear
  python manage.py seed_demo_content --clear-only
  docker compose exec web python manage.py seed_demo_content
"""
from __future__ import annotations

import random
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from bubbles.demo_seed_content import (
    DEFAULT_LAT,
    DEFAULT_LNG,
    SEED_COMMUNITIES,
    SEED_QUESTIONS,
)
from bubbles.image_utils import chat_image_upload_path
from bubbles.membership import membership_seed_demo
from bubbles.models import Bubble, Message, Question, Reply
from bubbles.seed_images import make_seed_placeholder

DEMO_ONLINE_COUNT = 4


class Command(BaseCommand):
    help = (
        "Create demo communities, chat messages, questions, and answers for onboarding. "
        "All content is marked system_seed_content=True and can be removed with --clear."
    )

    def add_arguments(self, parser):
        parser.add_argument("--lat", type=float, default=DEFAULT_LAT)
        parser.add_argument("--lng", type=float, default=DEFAULT_LNG)
        parser.add_argument(
            "--offset-km",
            type=float,
            default=0.25,
            help="Spread communities around center (km).",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Remove existing seed content before creating new.",
        )
        parser.add_argument(
            "--clear-only",
            action="store_true",
            help="Remove seed content only; do not create new.",
        )
        parser.add_argument(
            "--no-fake-online",
            action="store_true",
            help="Skip seeding Redis active user counts on communities.",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Re-seed communities/questions that already exist (delete and recreate).",
        )

    def handle(self, *args, **options):
        lat = options["lat"]
        lng = options["lng"]
        offset_km = options["offset_km"]
        seed_online = not options["no_fake_online"]
        force = options["force"]

        if options["clear"] or options["clear_only"]:
            cleared = self._clear_seed_content()
            self.stdout.write(self.style.WARNING(f"Cleared seed content: {cleared}"))
            if options["clear_only"]:
                self.stdout.write(self.style.SUCCESS("Done (no new content created)."))
                return

        radius = int(getattr(settings, "BUBBLLE_DEFAULT_RADIUS_M", 5000))
        bubble_by_title: dict[str, Bubble] = {}

        created_bubbles = 0
        skipped_bubbles = 0
        created_messages = 0
        created_questions = 0
        created_replies = 0

        with transaction.atomic():
            for i, spec in enumerate(SEED_COMMUNITIES):
                title = spec["title"]
                existing = Bubble.objects.filter(
                    title=title, system_seed_content=True
                ).first()

                if existing and not force:
                    bubble_by_title[title] = existing
                    skipped_bubbles += 1
                    self.stdout.write(f"  [skip] community exists: {title}")
                    continue

                if existing and force:
                    existing.delete()

                dlat = (i - 7) * (offset_km / 111.0)
                dlng = (i % 3 - 1) * (offset_km / (111.0 * max(0.5, abs(lat) / 90)))

                bubble = Bubble.objects.create(
                    title=title,
                    latitude=lat + dlat,
                    longitude=lng + dlng,
                    radius=radius,
                    expires_at=None,
                    active=True,
                    system_seed_content=True,
                )
                bubble_by_title[title] = bubble
                created_bubbles += 1

                msg_count = self._seed_community_messages(bubble, spec)
                created_messages += msg_count

                if seed_online:
                    membership_seed_demo(bubble.id, count=DEMO_ONLINE_COUNT)

                self.stdout.write(
                    self.style.SUCCESS(
                        f"  [{i + 1}/{len(SEED_COMMUNITIES)}] {title} "
                        f"— {msg_count} messages, id={bubble.id}"
                    )
                )

            for qspec in SEED_QUESTIONS:
                title = qspec["title"]
                existing_q = Question.objects.filter(
                    title=title, system_seed_content=True
                ).first()

                if existing_q and not force:
                    self.stdout.write(f"  [skip] question exists: {title}")
                    continue

                if existing_q and force:
                    existing_q.delete()

                linked = None
                bubble_title = qspec.get("bubble_title")
                if bubble_title:
                    linked = bubble_by_title.get(bubble_title) or Bubble.objects.filter(
                        title=bubble_title, system_seed_content=True
                    ).first()

                q_lat = linked.latitude if linked else lat
                q_lng = linked.longitude if linked else lng

                question = Question.objects.create(
                    title=title,
                    description=(qspec.get("description") or "").strip(),
                    anonymous_name=qspec["author"],
                    latitude=q_lat + random.uniform(-0.002, 0.002),
                    longitude=q_lng + random.uniform(-0.002, 0.002),
                    bubble=linked,
                    active=True,
                    system_seed_content=True,
                )

                reply_count = self._seed_question_replies(question, qspec["answers"])
                created_questions += 1
                created_replies += reply_count

                Question.objects.filter(pk=question.pk).update(
                    created_at=timezone.now() - timedelta(days=random.randint(1, 14)),
                    last_activity_at=timezone.now() - timedelta(hours=random.randint(1, 48)),
                )

                self.stdout.write(
                    self.style.SUCCESS(
                        f"  Q: {title} — {reply_count} answers"
                    )
                )

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Demo seed content complete."))
        self.stdout.write(f"  Communities created: {created_bubbles} (skipped {skipped_bubbles})")
        self.stdout.write(f"  Messages created: {created_messages}")
        self.stdout.write(f"  Questions created: {created_questions}")
        self.stdout.write(f"  Answers created: {created_replies}")
        self.stdout.write("")
        self.stdout.write("All content tagged system_seed_content=True (demo only).")
        self.stdout.write("Remove anytime: python manage.py seed_demo_content --clear-only")
        self.stdout.write("")
        self.stdout.write(f"Open app near lat/lng: {lat}, {lng}")

    @staticmethod
    def _clear_seed_content() -> dict[str, int]:
        """Delete all demo seed rows; cascades handle related messages."""
        reply_count = Reply.objects.filter(system_seed_content=True).count()
        question_count = Question.objects.filter(system_seed_content=True).count()
        message_count = Message.objects.filter(system_seed_content=True).count()
        bubble_count = Bubble.objects.filter(system_seed_content=True).count()

        Reply.objects.filter(system_seed_content=True).delete()
        Question.objects.filter(system_seed_content=True).delete()
        Bubble.objects.filter(system_seed_content=True).delete()

        return {
            "bubbles": bubble_count,
            "messages": message_count,
            "questions": question_count,
            "replies": reply_count,
        }

    def _seed_community_messages(self, bubble: Bubble, spec: dict) -> int:
        users: list[str] = spec["users"]
        lines: list = spec["messages"]
        now = timezone.now()
        created = 0

        for idx, line in enumerate(lines):
            speaker_idx = line[0]
            text = line[1]
            image_label = line[2] if len(line) > 2 else None
            author = users[speaker_idx % len(users)]
            minutes_ago = (len(lines) - idx) * random.randint(4, 12) + random.randint(10, 90)
            created_at = now - timedelta(minutes=minutes_ago)

            msg = Message(
                bubble=bubble,
                anonymous_name=author,
                message=text,
                system_seed_content=True,
            )

            if image_label:
                placeholder, width, height = make_seed_placeholder(image_label)
                msg.image_width = width
                msg.image_height = height
                msg.image.save(chat_image_upload_path(bubble.id), placeholder, save=False)

            msg.save()
            Message.objects.filter(pk=msg.pk).update(created_at=created_at)
            created += 1

        return created

    def _seed_question_replies(self, question: Question, answers: list[tuple[str, str]]) -> int:
        now = timezone.now()
        created = 0

        for idx, (author, text) in enumerate(answers):
            hours_ago = (len(answers) - idx) * random.randint(2, 8) + random.randint(1, 24)
            reply = Reply.objects.create(
                question=question,
                anonymous_name=author,
                message=text,
                system_seed_content=True,
            )
            Reply.objects.filter(pk=reply.pk).update(
                created_at=now - timedelta(hours=hours_ago)
            )
            created += 1

        return created
