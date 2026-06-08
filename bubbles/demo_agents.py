"""
Async AI chat agents: one WebSocket per demo persona, replies via OpenAI.

Requires: OPENAI_API_KEY, httpx, websockets
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx
import websockets
from websockets.exceptions import ConnectionClosed

from django.conf import settings as django_settings

from bubbles.demo_content import BUBBLE_TITLES, TOPIC_PROMPTS, USER_POOLS

logger = logging.getLogger("bubbles.demo_agents")


def _internal_http_headers(base_url: str) -> dict[str, str]:
    """Docker ai-agents call http://web:8000 — Django must see an allowed Host."""
    host = urlparse(base_url).hostname or ""
    if host in ("web", "web.local"):
        return {"Host": "localhost"}
    return {}


def _openai_api_key() -> str:
    return (
        getattr(django_settings, "OPENAI_API_KEY", "") or os.environ.get("OPENAI_API_KEY", "")
    ).strip()


@dataclass
class DemoBubbleSpec:
    """Plain bubble data for async agents (no ORM in async context)."""

    bubble_id: str
    title: str
    lat: float
    lng: float
    topic: str
    personas: list[str]


def load_demo_bubble_specs() -> list[DemoBubbleSpec]:
    """Sync only — latest active bubble per demo title (avoids stale duplicates)."""
    from bubbles.models import Bubble

    bubbles = Bubble.objects.filter(title__in=BUBBLE_TITLES, active=True).order_by("-created_at")
    by_title: dict[str, DemoBubbleSpec] = {}
    title_to_idx = {t: i for i, t in enumerate(BUBBLE_TITLES)}
    for b in bubbles:
        if b.title in by_title:
            continue
        idx = title_to_idx.get(b.title)
        if idx is None:
            continue
        by_title[b.title] = DemoBubbleSpec(
            bubble_id=str(b.id),
            title=b.title,
            lat=b.latitude,
            lng=b.longitude,
            topic=TOPIC_PROMPTS[idx],
            personas=list(USER_POOLS[idx]),
        )
    return [by_title[t] for t in BUBBLE_TITLES if t in by_title]


@dataclass
class AgentConfig:
    base_url: str = "http://127.0.0.1:8000"
    openai_model: str = "gpt-4o-mini"
    reply_delay_min: float = 1.5
    reply_delay_max: float = 4.0
    max_replies_per_message: int = 2
    history_lines: int = 12
    verbose: bool = True


def pick_repliers(pool: list["ChatAgent"], author: str, msg_id: str | None, max_n: int) -> list["ChatAgent"]:
    """Same agents chosen for every listener in the pool (deterministic)."""
    eligible = [a for a in pool if a.name != author]
    if not eligible:
        return []
    key = str(msg_id or author)
    ranked = sorted(eligible, key=lambda a: hash(f"{key}:{a.name}"))
    return ranked[:max_n]


@dataclass
class BubbleAgents:
    spec: DemoBubbleSpec
    agents: list["ChatAgent"] = field(default_factory=list)


@dataclass
class ChatAgent:
    bubble_id: str
    name: str
    topic: str
    lat: float
    lng: float
    config: AgentConfig
    cookie: str = ""
    recent: list[str] = field(default_factory=list)
    _reply_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def ws_url(self) -> str:
        parsed = urlparse(self.config.base_url)
        host = parsed.netloc or "127.0.0.1:8000"
        scheme = "wss" if parsed.scheme == "https" else "ws"
        return (
            f"{scheme}://{host}/ws/bubble/{self.bubble_id}/"
            f"?lat={self.lat}&lng={self.lng}"
        )

    async def bootstrap_session(self, client: httpx.AsyncClient) -> None:
        r = await client.get("/api/me/")
        r.raise_for_status()
        r = await client.patch("/api/me/", json={"anonymous_name": self.name})
        r.raise_for_status()
        parts = []
        cookie_name = getattr(django_settings, "BUBBLLE_SESSION_COOKIE_NAME", "bbl_anon")
        jar_val = client.cookies.get(cookie_name)
        if jar_val:
            parts.append(f"{cookie_name}={jar_val}")
        else:
            for k, v in client.cookies.items():
                parts.append(f"{k}={v}")
        self.cookie = "; ".join(parts)
        if not self.cookie:
            raise RuntimeError(f"{self.name}: session cookie missing after /api/me/")
        if self.config.verbose:
            logger.info("%s session ok (cookie set)", self.name)

    async def generate_reply(self, incoming_text: str, incoming_author: str) -> str:
        from openai import AsyncOpenAI

        api_key = _openai_api_key()
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set (add it to .env)")

        client = AsyncOpenAI(api_key=api_key)
        context = "\n".join(self.recent[-self.config.history_lines :])
        system = (
            f"You are '{self.name}' in a casual Indian group chat about {self.topic}. "
            "Reply in 1-2 short sentences. Mix Hindi and English (Hinglish) naturally. "
            "Sound like a real person on WhatsApp — friendly, opinions, occasional emoji. "
            "No hashtags, no 'As an AI', no bullet lists."
        )
        user = (
            f"Recent chat:\n{context}\n\n"
            f"{incoming_author} just said: {incoming_text}\n\n"
            f"Write your reply as {self.name}:"
        )
        resp = await client.chat.completions.create(
            model=self.config.openai_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=120,
            temperature=0.9,
        )
        text = (resp.choices[0].message.content or "").strip()
        return text[:500]

    async def send_chat(self, ws, text: str, reply_to: str | None = None) -> None:
        payload: dict[str, Any] = {
            "type": "chat",
            "message": text,
            "latitude": self.lat,
            "longitude": self.lng,
        }
        if reply_to:
            payload["reply_to"] = reply_to
        await ws.send(json.dumps(payload))

    async def run(self, pool: list["ChatAgent"]) -> None:
        ws_headers = {"Cookie": self.cookie} if self.cookie else {}
        internal = _internal_http_headers(self.config.base_url)
        if internal.get("Host"):
            ws_headers["Host"] = internal["Host"]
            ws_headers["Origin"] = "http://localhost"
        backoff = 3
        while True:
            try:
                async with websockets.connect(
                    self.ws_url(),
                    additional_headers=ws_headers,
                    ping_interval=20,
                    ping_timeout=20,
                ) as ws:
                    backoff = 3
                    if self.config.verbose:
                        logger.info("%s WS connected → bubble %s", self.name, self.bubble_id[:8])
                    async for raw in ws:
                        try:
                            data = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        await self._handle_event(ws, pool, data)
            except ConnectionClosed as exc:
                if self.config.verbose:
                    logger.warning("%s WS closed: %s", self.name, exc)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
            except Exception as exc:
                if self.config.verbose:
                    logger.error("%s WS error: %s", self.name, exc)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    async def _handle_event(
        self, ws, pool: list["ChatAgent"], data: dict[str, Any]
    ) -> None:
        if data.get("type") == "error":
            if self.config.verbose:
                logger.warning("%s server error: %s", self.name, data.get("code"))
            return
        if data.get("type") != "chat":
            return
        payload = data.get("payload") or {}
        author = payload.get("anonymous_name") or ""
        text = (payload.get("message") or "").strip()
        msg_id = payload.get("id")
        if not text:
            return

        line = f"{author}: {text}"
        for agent in pool:
            agent.recent.append(line)
            if len(agent.recent) > 40:
                agent.recent = agent.recent[-40:]

        if author == self.name:
            return

        pick = pick_repliers(pool, author, msg_id, self.config.max_replies_per_message)
        if self not in pick:
            return

        if self.config.verbose:
            logger.info("%s replying to %s: %s", self.name, author, text[:60])

        async with self._reply_lock:
            await asyncio.sleep(
                random.uniform(self.config.reply_delay_min, self.config.reply_delay_max)
            )
            try:
                reply = await self.generate_reply(text, author)
            except Exception as exc:
                logger.error("%s OpenAI failed: %s", self.name, exc)
                return
            if not reply:
                return
            try:
                await self.send_chat(ws, reply, reply_to=msg_id)
                if self.config.verbose:
                    logger.info("%s sent: %s", self.name, reply[:80])
            except Exception as exc:
                logger.error("%s send failed: %s", self.name, exc)


def load_demo_bubbles() -> list[DemoBubbleSpec]:
    """Alias for management commands."""
    return load_demo_bubble_specs()


async def run_all_agents(
    config: AgentConfig | None = None,
    specs: list[DemoBubbleSpec] | None = None,
) -> None:
    config = config or AgentConfig()
    demo = specs if specs is not None else []
    if not demo:
        raise RuntimeError("No demo bubbles found. Run: python manage.py seed_demo_chat")

    all_tasks: list[asyncio.Task] = []

    for spec in demo:
        if config.verbose:
            logger.info(
                "Listening: %s → %s/bubble/%s/",
                spec.title,
                config.base_url,
                spec.bubble_id,
            )

        pool: list[ChatAgent] = []
        for name in spec.personas:
            agent = ChatAgent(
                bubble_id=spec.bubble_id,
                name=name,
                topic=spec.topic,
                lat=spec.lat,
                lng=spec.lng,
                config=config,
            )
            async with httpx.AsyncClient(
                base_url=config.base_url,
                timeout=30.0,
                headers=_internal_http_headers(config.base_url),
            ) as client:
                await agent.bootstrap_session(client)
            pool.append(agent)
            await asyncio.sleep(0.15)

        for agent in pool:
            all_tasks.append(asyncio.create_task(agent.run(pool)))

    await asyncio.gather(*all_tasks)
