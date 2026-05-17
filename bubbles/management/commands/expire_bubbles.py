from django.core.management.base import BaseCommand
from django.utils import timezone

from bubbles.membership import membership_clear_many
from bubbles.models import Bubble


class Command(BaseCommand):
    help = "Deactivate expired bubbles and clear their Redis membership sets."

    def handle(self, *args, **options):
        now = timezone.now()
        qs = Bubble.objects.filter(active=True, expires_at__lte=now)
        bubble_ids = list(qs.values_list("id", flat=True))
        n = qs.update(active=False)
        membership_clear_many(bubble_ids)
        self.stdout.write(
            self.style.SUCCESS(f"Deactivated {n} expired bubble(s); cleared memberships.")
        )
