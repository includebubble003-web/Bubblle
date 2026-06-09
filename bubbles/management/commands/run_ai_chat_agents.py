"""
Run AI bots in every joinable bubble (1 per bubble by default).

Requires OPENAI_API_KEY in .env.

Usage:
  python manage.py run_ai_chat_agents
  docker compose up ai-agents
"""
from __future__ import annotations

import asyncio
import logging
import os

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from bubbles.demo_agents import AgentConfig, load_all_joinable_bubble_specs, run_all_agents
from bubbles.membership import membership_clear

logger = logging.getLogger("bubbles.demo_agents")


class Command(BaseCommand):
    help = "AI bots join every active bubble (1 per bubble); reply in Hindi when anyone chats."

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
            "--bots-per-bubble",
            type=int,
            default=settings.BUBBLLE_AI_BOTS_PER_BUBBLE,
            help="AI personas that join each bubble (default 1)",
        )
        parser.add_argument(
            "--max-replies",
            type=int,
            default=1,
            help="Max bots that reply to each new message (default 1)",
        )
        parser.add_argument(
            "--poll-seconds",
            type=int,
            default=settings.BUBBLLE_AI_POLL_SECONDS,
            help="How often to check for newly created bubbles (default 30)",
        )

    def handle(self, *args, **options):
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(message)s",
        )

        if not self._openai_key():
            raise CommandError(
                "OPENAI_API_KEY is not set inside this container.\n\n"
                "Add to ~/Bubblle/.env:\n"
                "  OPENAI_API_KEY=sk-your-key-here\n\n"
                "Then: docker compose up -d --force-recreate ai-agents"
            )

        bots_per = max(1, options["bots_per_bubble"])
        max_replies = min(max(1, options["max_replies"]), bots_per)
        config = AgentConfig(
            base_url=options["base_url"].rstrip("/"),
            openai_model=options["model"],
            max_replies_per_message=max_replies,
            bots_per_bubble=bots_per,
            poll_seconds=max(10, options["poll_seconds"]),
            reply_delay_min=float(settings.BUBBLLE_AI_REPLY_DELAY_MIN),
            reply_delay_max=float(settings.BUBBLLE_AI_REPLY_DELAY_MAX),
            reply_min_gap=float(settings.BUBBLLE_AI_REPLY_MIN_GAP),
        )

        specs = load_all_joinable_bubble_specs(bots_per)
        if not specs:
            raise CommandError(
                "No joinable bubbles found. Create one in the app or run:\n"
                "  docker compose exec web python manage.py seed_demo_chat --clear"
            )

        for spec in specs:
            membership_clear(spec.bubble_id)

        close_old_connections()

        total_bots = len(specs) * bots_per
        self.stdout.write(
            self.style.SUCCESS(
                f"Starting AI bots → {config.base_url} (model={config.openai_model})\n"
                f"{len(specs)} bubble(s), {bots_per} bot(s) each = {total_bots} connections.\n"
                f"New bubbles picked up every {int(config.poll_seconds)}s. Ctrl+C to stop."
            )
        )
        for spec in specs:
            self.stdout.write(
                f"  • {spec.title} — {', '.join(spec.personas)}\n"
                f"    {config.base_url}/bubble/{spec.bubble_id}/"
            )
        self.stdout.write("")
        try:
            asyncio.run(run_all_agents(config, specs=specs))
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("\nStopped AI agents."))

    @staticmethod
    def _openai_key() -> str:
        return (os.environ.get("OPENAI_API_KEY") or settings.OPENAI_API_KEY or "").strip()
