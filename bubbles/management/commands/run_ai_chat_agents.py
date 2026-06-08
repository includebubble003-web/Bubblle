"""
Run AI-powered demo users that join bubbles over WebSocket and reply to chat.

Requires OPENAI_API_KEY in .env (loaded automatically via Django settings).

Usage:
  # Add to .env: OPENAI_API_KEY=sk-...
  python manage.py seed_demo_chat --clear
  python manage.py run_ai_chat_agents

  docker compose up -d
  docker compose up ai-agents

  # Custom server URL (if not localhost)
  python manage.py run_ai_chat_agents --base-url http://127.0.0.1:8000
"""
from __future__ import annotations

import asyncio

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from bubbles.demo_agents import AgentConfig, load_demo_bubble_specs, run_all_agents
from bubbles.membership import membership_clear
from bubbles.models import Bubble
from bubbles.demo_content import BUBBLE_TITLES
from django.db import close_old_connections


class Command(BaseCommand):
    help = "Connect demo personas via WebSocket; AI replies when anyone chats (needs OPENAI_API_KEY)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--base-url",
            default=settings.BUBBLLE_BASE_URL,
            help="App base URL for /api/me/ and WebSocket host",
        )
        parser.add_argument(
            "--model",
            default=settings.OPENAI_MODEL,
            help="OpenAI chat model",
        )
        parser.add_argument(
            "--max-replies",
            type=int,
            default=2,
            help="Max AI personas that reply to each new message (default 2)",
        )

    def handle(self, *args, **options):
        if not settings.OPENAI_API_KEY:
            raise CommandError(
                "OPENAI_API_KEY missing. Add it to your .env file:\n"
                "  OPENAI_API_KEY=sk-..."
            )

        config = AgentConfig(
            base_url=options["base_url"].rstrip("/"),
            openai_model=options["model"],
            max_replies_per_message=max(1, options["max_replies"]),
        )

        specs = load_demo_bubble_specs()
        if not specs:
            raise CommandError(
                "No demo bubbles found. Run first:\n"
                "  python manage.py seed_demo_chat --clear"
            )

        # Replace fake seed counts with real WebSocket connections
        for b in Bubble.objects.filter(title__in=BUBBLE_TITLES, active=True):
            membership_clear(b.id)

        close_old_connections()

        self.stdout.write(
            self.style.SUCCESS(
                f"Starting AI agents → {config.base_url} (model={config.openai_model})\n"
                f"{len(specs)} bubbles, 10 personas each. Ctrl+C to stop."
            )
        )
        try:
            asyncio.run(run_all_agents(config, specs=specs))
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("\nStopped AI agents."))
