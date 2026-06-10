"""
Async AI chat agents: WebSocket clients that reply via OpenAI in every joinable bubble.

Requires: OPENAI_API_KEY, httpx, websockets
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx
import websockets
from websockets.exceptions import ConnectionClosed

from django.conf import settings as django_settings

from bubbles.demo_content import (
    BUBBLE_TITLES,
    build_archetype_system_prompt,
    mood_hint_for_message,
    pick_bot_identities,
    topic_for_bubble,
)
from bubbles.ai_activity import (
    generate_openai_batch,
    has_daily_quota,
    human_recently_active,
    queue_scheduled_messages,
    release_due_scheduled_messages,
    unreleased_scheduled_count,
)

logger = logging.getLogger("bubbles.demo_agents")


def _docker_internal_host(base_url: str) -> str | None:
    """Compose service name when ai-agents talk to the web container."""
    host = urlparse(base_url).hostname or ""
    if host in ("web", "web.local"):
        return host
    return None


def _internal_http_headers(base_url: str) -> dict[str, str]:
    """Docker ai-agents call http://web:8000 — Host must be in ALLOWED_HOSTS (web, not localhost)."""
    internal = _docker_internal_host(base_url)
    if internal:
        return {"Host": internal}
    return {}


def _internal_ws_origin(base_url: str) -> str | None:
    """Origin header for Channels AllowedHostsOriginValidator (must match ALLOWED_HOSTS)."""
    parsed = urlparse(base_url)
    internal = _docker_internal_host(base_url)
    if not internal:
        return None
    port = parsed.port
    if port and port not in (80, 443):
        return f"http://{internal}:{port}"
    return f"http://{internal}"


def _openai_api_key() -> str:
    return (
        getattr(django_settings, "OPENAI_API_KEY", "") or os.environ.get("OPENAI_API_KEY", "")
    ).strip()


@dataclass
class BubbleAgentSpec:
    """Plain bubble data for async agents (no ORM in async context)."""

    bubble_id: str
    title: str
    lat: float
    lng: float
    topic: str
    personas: list[str]
    archetypes: list[str]


# Backward-compatible alias
DemoBubbleSpec = BubbleAgentSpec


def load_all_joinable_bubble_specs(
    bots_per_bubble: int | None = None,
) -> list[BubbleAgentSpec]:
    """Every active, non-expired bubble — one AI persona each by default."""
    from django.utils import timezone

    from bubbles.models import Bubble

    if bots_per_bubble is None:
        bots_per_bubble = int(getattr(django_settings, "BUBBLLE_AI_BOTS_PER_BUBBLE", 1))

    now = timezone.now()
    bubbles = Bubble.objects.filter(active=True, expires_at__gt=now).order_by("-created_at")
    specs: list[BubbleAgentSpec] = []
    for b in bubbles:
        bid = str(b.id)
        identities = pick_bot_identities(bid, bots_per_bubble)
        specs.append(
            BubbleAgentSpec(
                bubble_id=bid,
                title=b.title,
                lat=b.latitude,
                lng=b.longitude,
                topic=topic_for_bubble(b.title),
                personas=[n for n, _ in identities],
                archetypes=[a for _, a in identities],
            )
        )
    return specs


def load_demo_bubble_specs(bots_per_bubble: int | None = None) -> list[BubbleAgentSpec]:
    """Latest joinable bubble per demo title only (for seed validation)."""
    all_specs = load_all_joinable_bubble_specs(bots_per_bubble)
    by_title: dict[str, BubbleAgentSpec] = {}
    for spec in all_specs:
        if spec.title in BUBBLE_TITLES and spec.title not in by_title:
            by_title[spec.title] = spec
    return [by_title[t] for t in BUBBLE_TITLES if t in by_title]


def get_joinable_spec_for_bubble_id(bubble_id: str) -> BubbleAgentSpec | None:
    for spec in load_all_joinable_bubble_specs():
        if spec.bubble_id == bubble_id:
            return spec
    return None


@dataclass
class AgentConfig:
    base_url: str = "http://127.0.0.1:8000"
    openai_model: str = "gpt-4o-mini"
    reply_delay_min: float = 10.0
    reply_delay_max: float = 10.0
    reply_min_gap: float = 10.0
    max_replies_per_message: int = 1
    bots_per_bubble: int = 1
    poll_seconds: float = 30.0
    release_poll_seconds: float = 45.0
    history_lines: int = 12
    verbose: bool = True
    reactive_reply_enabled: bool = False


@dataclass
class BubbleReplyGate:
    """One reply per message; minimum gap between any two bot replies in a bubble."""

    min_gap_seconds: float = 60.0
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    _claimed_messages: set[str] = field(default_factory=set)
    _last_reply_at: float = 0.0

    async def try_claim(self, msg_id: str | None) -> bool:
        """Only one bot may reply to a given message id."""
        async with self._lock:
            if msg_id:
                key = str(msg_id)
                if key in self._claimed_messages:
                    return False
                self._claimed_messages.add(key)
                if len(self._claimed_messages) > 500:
                    self._claimed_messages.clear()
            return True

    async def extra_wait_seconds(self) -> float:
        """Seconds to wait so bot replies are at least min_gap apart."""
        async with self._lock:
            if not self._last_reply_at:
                return 0.0
            elapsed = time.monotonic() - self._last_reply_at
            return max(0.0, self.min_gap_seconds - elapsed)

    async def mark_replied(self) -> None:
        async with self._lock:
            self._last_reply_at = time.monotonic()


def pick_repliers(pool: list["ChatAgent"], author: str, msg_id: str | None, max_n: int) -> list["ChatAgent"]:
    """Same agents chosen for every listener in the pool (deterministic)."""
    eligible = [a for a in pool if a.name != author]
    if not eligible:
        return []
    key = str(msg_id or author)
    ranked = sorted(eligible, key=lambda a: hash(f"{key}:{a.name}"))
    return ranked[:max_n]


@dataclass
class ChatAgent:
    bubble_id: str
    bubble_title: str
    name: str
    archetype: str
    topic: str
    lat: float
    lng: float
    config: AgentConfig
    cookie: str = ""
    recent: list[str] = field(default_factory=list)
    _reply_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    _pool_gate: BubbleReplyGate | None = None

    def ws_url(self) -> str:
        parsed = urlparse(self.config.base_url)
        host = parsed.netloc or "127.0.0.1:8000"
        scheme = "wss" if parsed.scheme == "https" else "ws"
        return (
            f"{scheme}://{host}/ws/bubble/{self.bubble_id}/"
            f"?lat={self.lat}&lng={self.lng}"
        )

    async def bootstrap_session(self, client: httpx.AsyncClient) -> None:
        cookie_name = getattr(django_settings, "BUBBLLE_SESSION_COOKIE_NAME", "bbl_anon")

        r = await client.get("/api/me/")
        r.raise_for_status()
        session_uuid = (r.json() or {}).get("session_uuid")

        r = await client.patch("/api/me/", json={"anonymous_name": self.name})
        r.raise_for_status()
        session_uuid = (r.json() or {}).get("session_uuid") or session_uuid

        if not session_uuid:
            jar_val = client.cookies.get(cookie_name)
            if jar_val:
                session_uuid = jar_val
            else:
                raise RuntimeError(
                    f"{self.name}: no session_uuid from /api/me/ (check web SESSION_COOKIE_SECURE)"
                )

        self.cookie = f"{cookie_name}={session_uuid}"
        if self.config.verbose:
            logger.info("%s session ok (%s…)", self.name, str(session_uuid)[:8])

    async def _refresh_bubble_spec(self) -> bool:
        """Reload bubble if still joinable (after expiry)."""
        from asgiref.sync import sync_to_async
        from django.db import close_old_connections

        @sync_to_async
        def _load() -> BubbleAgentSpec | None:
            close_old_connections()
            return get_joinable_spec_for_bubble_id(self.bubble_id)

        spec = await _load()
        if not spec:
            return False
        self.lat = spec.lat
        self.lng = spec.lng
        self.topic = spec.topic
        self.bubble_title = spec.title
        return True

    async def generate_reply(
        self, incoming_text: str, incoming_author: str, msg_id: str | None = None
    ) -> str:
        from openai import AsyncOpenAI

        api_key = _openai_api_key()
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set (add it to .env)")

        client = AsyncOpenAI(api_key=api_key)
        context = "\n".join(self.recent[-self.config.history_lines :])
        mood = mood_hint_for_message(self.bubble_id, self.name, msg_id)
        system = build_archetype_system_prompt(
            self.name, self.topic, self.archetype, mood
        )
        user = (
            f"Recent chat:\n{context or '(abhi kuch nahi)'}\n\n"
            f"{incoming_author} ne abhi likha: {incoming_text}\n\n"
            f"Sirf apna reply likh — {self.name} ({self.archetype}), pehle se use ki hui "
            f"opening lines mat use kar:"
        )
        resp = await client.chat.completions.create(
            model=self.config.openai_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=100,
            temperature=1.0,
            presence_penalty=0.6,
            frequency_penalty=0.5,
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
        ws_origin = _internal_ws_origin(self.config.base_url)
        backoff = 3
        reconnects = 0
        while True:
            if reconnects:
                if not await self._refresh_bubble_spec():
                    if self.config.verbose:
                        logger.warning(
                            "%s bubble %s expired or gone",
                            self.name,
                            self.bubble_id[:8],
                        )
            try:
                async with websockets.connect(
                    self.ws_url(),
                    origin=ws_origin,
                    additional_headers=ws_headers,
                    ping_interval=20,
                    ping_timeout=20,
                ) as ws:
                    backoff = 3
                    reconnects = 0
                    if self.config.verbose:
                        logger.info(
                            "%s [%s] WS connected → bubble %s",
                            self.name,
                            self.archetype,
                            self.bubble_id[:8],
                        )
                    async for raw in ws:
                        try:
                            data = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        await self._handle_event(ws, pool, data)
            except ConnectionClosed as exc:
                reconnects += 1
                if self.config.verbose:
                    logger.warning("%s WS closed: %s", self.name, exc)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
            except Exception as exc:
                reconnects += 1
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

        pool_names = {a.name for a in pool}
        if author in pool_names:
            return

        line = f"{author}: {text}"
        for agent in pool:
            agent.recent.append(line)
            if len(agent.recent) > 40:
                agent.recent = agent.recent[-40:]

        if author == self.name:
            return

        # Cost control: do not reply to every human message by default.
        if not self.config.reactive_reply_enabled:
            return

        if human_recently_active(self.bubble_id):
            return

        if not has_daily_quota(self.bubble_id):
            return

        pick = pick_repliers(pool, author, msg_id, self.config.max_replies_per_message)
        if self not in pick:
            return

        gate = self._pool_gate
        if gate and not await gate.try_claim(msg_id):
            return

        reply_index = pick.index(self)
        base_wait = random.uniform(self.config.reply_delay_min, self.config.reply_delay_max)
        stagger = reply_index * self.config.reply_min_gap
        gap_wait = await gate.extra_wait_seconds() if gate else 0.0
        total_wait = base_wait + stagger + gap_wait

        if self.config.verbose:
            logger.info(
                "%s will reply to %s in %.0fs: %s",
                self.name,
                author,
                total_wait,
                text[:60],
            )

        async with self._reply_lock:
            await asyncio.sleep(total_wait)
            try:
                reply = await self.generate_reply(text, author, msg_id=msg_id)
            except Exception as exc:
                logger.error("%s OpenAI failed: %s", self.name, exc)
                return
            if not reply:
                return
            try:
                await self.send_chat(ws, reply, reply_to=msg_id)
                if gate:
                    await gate.mark_replied()
                if self.config.verbose:
                    logger.info("%s sent: %s", self.name, reply[:80])
            except Exception as exc:
                logger.error("%s send failed: %s", self.name, exc)


def load_demo_bubbles() -> list[BubbleAgentSpec]:
    """Alias for management commands."""
    return load_demo_bubble_specs()


async def _maybe_openai_refill(bubble_id: str, title: str, config: AgentConfig) -> None:
    """Background one-shot batch generation when queue runs dry (max 1/day/bubble)."""
    from asgiref.sync import sync_to_async
    from django.db import close_old_connections

    if human_recently_active(bubble_id) or not has_daily_quota(bubble_id, need=5):
        return
    try:
        lines = await generate_openai_batch(title, bubble_id)
    except Exception as exc:
        logger.warning("OpenAI batch refill failed for %s: %s", bubble_id[:8], exc)
        return

    @sync_to_async
    def _queue():
        close_old_connections()
        from bubbles.models import Bubble

        bubble = Bubble.objects.filter(id=bubble_id, active=True).first()
        if not bubble or not bubble.is_joinable():
            return
        queue_scheduled_messages(bubble, lines)

    await _queue()
    if config.verbose:
        logger.info("OpenAI batch refill queued %s lines → %s", len(lines), bubble_id[:8])


async def _scheduled_release_loop_v2(config: AgentConfig, started: set[str]) -> None:
    """Poll all started bubbles for due scheduled messages."""
    from asgiref.sync import sync_to_async
    from django.core.cache import cache
    from django.db import close_old_connections
    from django.utils import timezone

    while True:
        await asyncio.sleep(config.release_poll_seconds)
        for bubble_id in list(started):
            try:

                @sync_to_async
                def _release(bid: str = bubble_id) -> int:
                    close_old_connections()
                    return len(release_due_scheduled_messages(bid))

                n = await _release()
                if n and config.verbose:
                    logger.info("Released %s scheduled msg(s) → %s", n, bubble_id[:8])

                @sync_to_async
                def _needs_refill(bid: str = bubble_id) -> bool:
                    close_old_connections()
                    if unreleased_scheduled_count(bid) > 5:
                        return False
                    if human_recently_active(bid) or not has_daily_quota(bid, need=5):
                        return False
                    return True

                if not await _needs_refill():
                    continue
                day_key = f"ai:batch:refill:{bubble_id}:{timezone.now().date().isoformat()}"
                if cache.get(day_key):
                    continue
                cache.set(day_key, "1", timeout=60 * 60 * 26)

                @sync_to_async
                def _title(bid: str = bubble_id) -> str:
                    close_old_connections()
                    from bubbles.models import Bubble

                    b = Bubble.objects.filter(id=bid).only("title").first()
                    return b.title if b else ""

                title = await _title()
                if title:
                    await _maybe_openai_refill(bubble_id, title, config)
            except Exception as exc:
                logger.error("release loop error %s: %s", bubble_id[:8], exc)


async def _start_bubble_agents(
    spec: BubbleAgentSpec,
    config: AgentConfig,
    started: set[str],
    tasks: list[asyncio.Task],
) -> None:
    if spec.bubble_id in started:
        return
    started.add(spec.bubble_id)

    if config.verbose:
        logger.info(
            "Bubble: %s → %s/bubble/%s/ (%s)",
            spec.title[:40],
            config.base_url,
            spec.bubble_id,
            ", ".join(f"{n} [{a}]" for n, a in zip(spec.personas, spec.archetypes, strict=True)),
        )

    pool: list[ChatAgent] = []
    gate = BubbleReplyGate(min_gap_seconds=config.reply_min_gap)
    for name, archetype in zip(spec.personas, spec.archetypes, strict=True):
        agent = ChatAgent(
            bubble_id=spec.bubble_id,
            bubble_title=spec.title,
            name=name,
            archetype=archetype,
            topic=spec.topic,
            lat=spec.lat,
            lng=spec.lng,
            config=config,
            _pool_gate=gate,
        )
        async with httpx.AsyncClient(
            base_url=config.base_url,
            timeout=30.0,
            headers=_internal_http_headers(config.base_url),
        ) as client:
            await agent.bootstrap_session(client)
        pool.append(agent)
        await asyncio.sleep(0.1)

    for agent in pool:
        tasks.append(asyncio.create_task(agent.run(pool)))


async def run_all_agents(
    config: AgentConfig | None = None,
    specs: list[BubbleAgentSpec] | None = None,
) -> None:
    config = config or AgentConfig()
    started: set[str] = set()
    tasks: list[asyncio.Task] = []

    from asgiref.sync import sync_to_async

    @sync_to_async
    def _load_all() -> list[BubbleAgentSpec]:
        return load_all_joinable_bubble_specs(config.bots_per_bubble)

    initial = specs if specs is not None else await _load_all()
    if not initial:
        raise RuntimeError("No joinable bubbles found. Create one in the app or run seed_demo_chat.")

    for spec in initial:
        await _start_bubble_agents(spec, config, started, tasks)

    async def poll_new_bubbles() -> None:
        while True:
            await asyncio.sleep(config.poll_seconds)
            try:
                current = await _load_all()
                for spec in current:
                    if spec.bubble_id not in started:
                        await _start_bubble_agents(spec, config, started, tasks)
            except Exception as exc:
                logger.error("bubble poll failed: %s", exc)

    tasks.append(asyncio.create_task(poll_new_bubbles()))
    tasks.append(asyncio.create_task(_scheduled_release_loop_v2(config, started)))
    await asyncio.gather(*tasks)
