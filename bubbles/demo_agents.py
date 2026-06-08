"""
Async AI chat agents: one WebSocket per demo persona, replies via OpenAI.

Requires: OPENAI_API_KEY, httpx, websockets
"""
from __future__ import annotations

import asyncio
import json
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
from bubbles.models import Bubble


def _openai_api_key() -> str:
    return (getattr(django_settings, "OPENAI_API_KEY", "") or os.environ.get("OPENAI_API_KEY", "")).strip()


@dataclass
class AgentConfig:
    base_url: str = "http://127.0.0.1:8000"
    openai_model: str = "gpt-4o-mini"
    reply_delay_min: float = 1.5
    reply_delay_max: float = 4.0
    max_replies_per_message: int = 2
    history_lines: int = 12


@dataclass
class BubbleAgents:
    bubble: Bubble
    topic: str
    personas: list[str]
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
        parts = [f"{k}={v}" for k, v in client.cookies.items()]
        self.cookie = "; ".join(parts)

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
        headers = {"Cookie": self.cookie} if self.cookie else {}
        backoff = 3
        while True:
            try:
                async with websockets.connect(
                    self.ws_url(),
                    additional_headers=headers,
                    ping_interval=20,
                    ping_timeout=20,
                ) as ws:
                    backoff = 3
                    async for raw in ws:
                        try:
                            data = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        await self._handle_event(ws, pool, data)
            except ConnectionClosed:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
            except Exception:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    async def _handle_event(
        self, ws, pool: list["ChatAgent"], data: dict[str, Any]
    ) -> None:
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

        # Only some agents reply per message to avoid 10x spam
        eligible = [a for a in pool if a.name != author]
        random.shuffle(eligible)
        pick = eligible[: self.config.max_replies_per_message]
        if self not in pick:
            return

        async with self._reply_lock:
            await asyncio.sleep(
                random.uniform(self.config.reply_delay_min, self.config.reply_delay_max)
            )
            try:
                reply = await self.generate_reply(text, author)
            except Exception:
                return
            if not reply:
                return
            try:
                await self.send_chat(ws, reply, reply_to=msg_id)
            except Exception:
                return


def load_demo_bubbles() -> list[tuple[Bubble, str, list[str]]]:
    bubbles = list(Bubble.objects.filter(title__in=BUBBLE_TITLES, active=True).order_by("created_at"))
    out: list[tuple[Bubble, str, list[str]]] = []
    title_to_idx = {t: i for i, t in enumerate(BUBBLE_TITLES)}
    for b in bubbles:
        idx = title_to_idx.get(b.title)
        if idx is None:
            continue
        out.append((b, TOPIC_PROMPTS[idx], USER_POOLS[idx]))
    return out


async def run_all_agents(config: AgentConfig | None = None) -> None:
    config = config or AgentConfig()
    demo = load_demo_bubbles()
    if not demo:
        raise RuntimeError("No demo bubbles found. Run: python manage.py seed_demo_chat")

    all_tasks: list[asyncio.Task] = []

    for bubble, topic, personas in demo:
        pool: list[ChatAgent] = []
        for name in personas:
            agent = ChatAgent(
                bubble_id=str(bubble.id),
                name=name,
                topic=topic,
                lat=bubble.latitude,
                lng=bubble.longitude,
                config=config,
            )
            async with httpx.AsyncClient(base_url=config.base_url, timeout=30.0) as client:
                await agent.bootstrap_session(client)
            pool.append(agent)

        for agent in pool:
            all_tasks.append(asyncio.create_task(agent.run(pool)))

    await asyncio.gather(*all_tasks)
