"""
Run AI-powered demo users that join bubbles over WebSocket and reply to chat.

Requires OPENAI_API_KEY in environment.

Usage:
  export OPENAI_API_KEY=sk-...
  python manage.py seed_demo_chat --clear
  python manage.py run_ai_chat_agents

  docker compose exec web python manage.py run_ai_chat_agents

  # Custom server URL (if not localhost)
  python manage.py run_ai_chat_agents --base-url http://127.0.0.1:8000
"""
from __future__ import annotations

import asyncio
import os

from django.core.management.base import BaseCommand, CommandError

from bubbles.demo_agents import AgentConfig, run_all_agents
from bubbles.membership import membership_clear
from bubbles.models import Bubble
from bubbles.demo_content import BUBBLE_TITLES


class Command(BaseCommand):
    help = "Connect demo personas via WebSocket; AI replies when anyone chats (needs OPENAI_API_KEY)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--base-url",
            default=os.environ.get("BUBBLLE_BASE_URL", "http://127.0.0.1:8000"),
            help="App base URL for /api/me/ and WebSocket host",
        )
        parser.add_argument(
            "--model",
            default=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            help="OpenAI chat model",
        )
        parser.add_argument(
            "--max-replies",
            type=int,
            default=2,
            help="Max AI personas that reply to each new message (default 2)",
        )

    def handle(self, *args, **options):
        if not os.environ.get("OPENAI_API_KEY", "").strip():
            raise CommandError(
                "Set OPENAI_API_KEY first, e.g. export OPENAI_API_KEY=sk-..."
            )

        config = AgentConfig(
            base_url=options["base_url"].rstrip("/"),
            openai_model=options["model"],
            max_replies_per_message=max(1, options["max_replies"]),
        )

        # Replace fake seed counts with real WebSocket connections
        for b in Bubble.objects.filter(title__in=BUBBLE_TITLES, active=True):
            membership_clear(b.id)

        self.stdout.write(
            self.style.SUCCESS(
                f"Starting AI agents → {config.base_url} (model={config.openai_model})\n"
                "10 personas × 5 demo bubbles. Ctrl+C to stop."
            )
        )
        try:
            asyncio.run(run_all_agents(config))
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("\nStopped AI agents."))
