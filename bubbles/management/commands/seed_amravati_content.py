"""
Seed Amravati-local demo questions, answers, and community chat lines.

Run after seed_demo_content so communities exist:
  python manage.py seed_demo_content
  python manage.py seed_amravati_content

Usage:
  python manage.py seed_amravati_content
  python manage.py seed_amravati_content --clear-only
  docker compose exec web python manage.py seed_amravati_content
"""
from __future__ import annotations

import random
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from bubbles.demo_seed_amravati import (
    AMRAVATI_COMMUNITY_MESSAGES,
    AMRAVATI_MESSAGE_TEXTS,
    AMRAVATI_QUESTION_TITLES,
    AMRAVATI_QUESTIONS,
    DEFAULT_LAT,
    DEFAULT_LNG,
)
from bubbles.models import Bubble, Message, Question, Reply


class Command(BaseCommand):
    help = (
        "Add Amravati-local demo questions, answers, and community messages. "
        "Idempotent — safe to run multiple times. Tagged system_seed_content=True."
    )

    def add_arguments(self, parser):
        parser.add_argument("--lat", type=float, default=DEFAULT_LAT)
        parser.add_argument("--lng", type=float, default=DEFAULT_LNG)
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Remove Amravati seed content before creating.",
        )
        parser.add_argument(
            "--clear-only",
            action="store_true",
            help="Remove Amravati seed content only.",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Re-create questions that already exist.",
        )

    def handle(self, *args, **options):
        lat = options["lat"]
        lng = options["lng"]
        force = options["force"]

        if options["clear"] or options["clear_only"]:
            cleared = self._clear_amravati_content()
            self.stdout.write(self.style.WARNING(f"Cleared Amravati seed: {cleared}"))
            if options["clear_only"]:
                self.stdout.write(self.style.SUCCESS("Done."))
                return

        created_messages = 0
        skipped_messages = 0
        created_questions = 0
        created_replies = 0
        skipped_questions = 0
        missing_bubbles: list[str] = []

        with transaction.atomic():
            for group in AMRAVATI_COMMUNITY_MESSAGES:
                title = group["bubble_title"]
                bubble = Bubble.objects.filter(title=title).first()
                if not bubble:
                    missing_bubbles.append(title)
                    self.stdout.write(
                        self.style.WARNING(
                            f"  [skip] community not found: {title} "
                            "(run seed_demo_content first)"
                        )
                    )
                    continue

                group_created = 0
                for author, text in group["messages"]:
                    if Message.objects.filter(
                        bubble=bubble,
                        message=text,
                        system_seed_content=True,
                    ).exists():
                        skipped_messages += 1
                        continue

                    minutes_ago = random.randint(30, 720)
                    msg = Message.objects.create(
                        bubble=bubble,
                        anonymous_name=author,
                        message=text,
                        system_seed_content=True,
                    )
                    Message.objects.filter(pk=msg.pk).update(
                        created_at=timezone.now() - timedelta(minutes=minutes_ago)
                    )
                    group_created += 1
                    created_messages += 1

                self.stdout.write(
                    self.style.SUCCESS(
                        f"  Community: {title} — +{group_created} new lines"
                    )
                )

            for qspec in AMRAVATI_QUESTIONS:
                title = qspec["title"]
                existing_q = Question.objects.filter(
                    title=title,
                    system_seed_content=True,
                ).first()

                if existing_q and not force:
                    skipped_questions += 1
                    self.stdout.write(f"  [skip] question exists: {title}")
                    continue

                if existing_q and force:
                    existing_q.delete()

                linked = None
                bubble_title = qspec.get("bubble_title")
                if bubble_title:
                    linked = Bubble.objects.filter(title=bubble_title).first()
                    if not linked and bubble_title not in missing_bubbles:
                        missing_bubbles.append(bubble_title)

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

                reply_count = self._seed_replies(question, qspec["answers"])
                created_questions += 1
                created_replies += reply_count

                Question.objects.filter(pk=question.pk).update(
                    created_at=timezone.now() - timedelta(days=random.randint(2, 21)),
                    last_activity_at=timezone.now() - timedelta(hours=random.randint(1, 72)),
                )

                self.stdout.write(
                    self.style.SUCCESS(f"  Q: {title} — {reply_count} answers")
                )

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Amravati local seed complete."))
        self.stdout.write(f"  Community messages added: {created_messages} (skipped {skipped_messages})")
        self.stdout.write(f"  Questions created: {created_questions} (skipped {skipped_questions})")
        self.stdout.write(f"  Answers created: {created_replies}")
        if missing_bubbles:
            self.stdout.write("")
            self.stdout.write(
                self.style.WARNING(
                    "Missing communities — run first: python manage.py seed_demo_content"
                )
            )
        self.stdout.write("")
        self.stdout.write(f"Open app near lat/lng: {lat}, {lng}")
        self.stdout.write("Remove: python manage.py seed_amravati_content --clear-only")

    @staticmethod
    def _clear_amravati_content() -> dict[str, int]:
        msg_qs = Message.objects.filter(
            system_seed_content=True,
            message__in=AMRAVATI_MESSAGE_TEXTS,
        )
        msg_count = msg_qs.count()
        msg_qs.delete()

        reply_count = Reply.objects.filter(
            question__title__in=AMRAVATI_QUESTION_TITLES,
            system_seed_content=True,
        ).count()
        q_count = Question.objects.filter(
            title__in=AMRAVATI_QUESTION_TITLES,
            system_seed_content=True,
        ).count()

        Question.objects.filter(
            title__in=AMRAVATI_QUESTION_TITLES,
            system_seed_content=True,
        ).delete()

        return {
            "messages": msg_count,
            "questions": q_count,
            "replies": reply_count,
        }

    @staticmethod
    def _seed_replies(question: Question, answers: list[tuple[str, str]]) -> int:
        now = timezone.now()
        for idx, (author, text) in enumerate(answers):
            hours_ago = (len(answers) - idx) * random.randint(2, 10) + random.randint(1, 36)
            reply = Reply.objects.create(
                question=question,
                anonymous_name=author,
                message=text,
                system_seed_content=True,
            )
            Reply.objects.filter(pk=reply.pk).update(
                created_at=now - timedelta(hours=hours_ago)
            )
        return len(answers)
