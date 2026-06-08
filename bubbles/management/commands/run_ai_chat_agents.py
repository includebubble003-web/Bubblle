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
import logging
import os

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from bubbles.demo_agents import AgentConfig, load_demo_bubble_specs, run_all_agents
from bubbles.demo_content import BUBBLE_TITLES
from bubbles.membership import membership_clear
from django.db import close_old_connections

logger = logging.getLogger("bubbles.demo_agents")


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
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(message)s",
        )

        if not self._openai_key():
            raise CommandError(
                "OPENAI_API_KEY is not set inside this container.\n\n"
                "The .env file is NOT in git — you must add the key on each server:\n"
                "  cd ~/Bubblle\n"
                "  nano .env\n"
                "  OPENAI_API_KEY=sk-your-key-here\n\n"
                "Then recreate the service:\n"
                "  docker compose up -d --force-recreate ai-agents\n\n"
                "Verify:\n"
                "  docker compose exec ai-agents printenv OPENAI_API_KEY | head -c 12"
            )

        config = AgentConfig(
            base_url=options["base_url"].rstrip("/"),
            openai_model=options["model"],
            max_replies_per_message=max(1, options["max_replies"]),
        )

        specs = load_demo_bubble_specs()
        if not specs:
            raise CommandError(
                "No joinable demo bubbles found. Run first:\n"
                "  docker compose exec web python manage.py seed_demo_chat --clear"
            )

        missing = [t for t in BUBBLE_TITLES if t not in {s.title for s in specs}]
        if missing:
            raise CommandError(
                "Some demo bubbles are missing or expired — re-seed:\n"
                "  docker compose exec web python manage.py seed_demo_chat --clear\n"
                f"  Missing: {', '.join(missing)}"
            )

        # Replace fake seed counts with real WebSocket connections
        for spec in specs:
            membership_clear(spec.bubble_id)

        close_old_connections()

        self.stdout.write(
            self.style.SUCCESS(
                f"Starting AI agents → {config.base_url} (model={config.openai_model})\n"
                f"{len(specs)} bubbles, 10 personas each. Ctrl+C to stop.\n"
                "Open the bubble URLs logged below (must match seeded demo rooms)."
            )
        )
        for spec in specs:
            self.stdout.write(f"  • {spec.title}")
            self.stdout.write(f"    {config.base_url}/bubble/{spec.bubble_id}/")
        self.stdout.write("")
        try:
            asyncio.run(run_all_agents(config, specs=specs))
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("\nStopped AI agents."))

    @staticmethod
    def _openai_key() -> str:
        return (os.environ.get("OPENAI_API_KEY") or settings.OPENAI_API_KEY or "").strip()
