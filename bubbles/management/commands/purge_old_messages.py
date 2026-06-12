"""Delete chat messages older than the configured retention window."""
from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from bubbles.models import Message


class Command(BaseCommand):
    help = "Delete chat messages older than BUBBLLE_MESSAGE_RETENTION_HOURS (default 48)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--hours",
            type=float,
            default=None,
            help="Override retention window in hours.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report how many messages would be deleted without deleting.",
        )

    def handle(self, *args, **options):
        hours = options["hours"]
        if hours is None:
            hours = float(getattr(settings, "BUBBLLE_MESSAGE_RETENTION_HOURS", 48))
        cutoff = timezone.now() - timedelta(hours=hours)
        qs = Message.objects.filter(created_at__lt=cutoff).order_by("created_at")

        count = qs.count()
        if count == 0:
            self.stdout.write(self.style.SUCCESS("No messages to purge."))
            return

        if options["dry_run"]:
            self.stdout.write(
                self.style.WARNING(f"Dry run: would delete {count} message(s) older than {hours:g}h.")
            )
            return

        deleted = 0
        for msg in qs.iterator(chunk_size=200):
            if msg.image:
                msg.image.delete(save=False)
            msg.delete()
            deleted += 1

        self.stdout.write(
            self.style.SUCCESS(f"Deleted {deleted} message(s) older than {hours:g} hours.")
        )
