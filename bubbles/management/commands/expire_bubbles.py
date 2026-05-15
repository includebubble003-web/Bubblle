from django.core.management.base import BaseCommand
from django.utils import timezone

from bubbles.models import Bubble


class Command(BaseCommand):
    help = "Mark expired bubbles inactive so they stop accepting traffic."

    def handle(self, *args, **options):
        now = timezone.now()
        qs = Bubble.objects.filter(active=True, expires_at__lte=now)
        n = qs.update(active=False)
        self.stdout.write(self.style.SUCCESS(f"Deactivated {n} expired bubble(s)."))
