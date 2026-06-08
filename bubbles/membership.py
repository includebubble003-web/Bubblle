"""
Redis-backed bubble membership: one set entry per active WebSocket connection.

Members are keyed by Channels `channel_name` so multiple tabs count separately and
disconnect always removes the correct connection.
"""
from __future__ import annotations

from uuid import UUID

import redis
from django.conf import settings

_redis_client: redis.Redis | None = None

# TTL refreshed on each join so idle keys eventually expire if disconnect is missed.
MEMBERSHIP_TTL_SECONDS = 86_400


def _client() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client


def _members_key(bubble_id: UUID | str) -> str:
    return f"bbl:bubble:{bubble_id}:members"


def membership_join(bubble_id: UUID | str, connection_id: str) -> int:
    """Add a connected client; returns current active count."""
    r = _client()
    key = _members_key(bubble_id)
    r.sadd(key, connection_id)
    r.expire(key, MEMBERSHIP_TTL_SECONDS)
    return int(r.scard(key))


def membership_leave(bubble_id: UUID | str, connection_id: str) -> int:
    """Remove a disconnected client; returns current active count."""
    r = _client()
    key = _members_key(bubble_id)
    r.srem(key, connection_id)
    count = int(r.scard(key))
    if count == 0:
        r.delete(key)
    return count


def membership_count(bubble_id: UUID | str) -> int:
    """Number of currently connected WebSocket clients in this bubble."""
    return int(_client().scard(_members_key(bubble_id)))


def membership_clear(bubble_id: UUID | str) -> None:
    """Drop all members (e.g. when a bubble expires)."""
    _client().delete(_members_key(bubble_id))


def membership_clear_many(bubble_ids: list) -> None:
    if not bubble_ids:
        return
    r = _client()
    keys = [_members_key(bid) for bid in bubble_ids]
    if keys:
        r.delete(*keys)


def membership_seed_demo(bubble_id: UUID | str, count: int = 10, prefix: str = "demo-seed") -> int:
    """
    Seed Redis membership so active_users shows online count for demo bubbles.
    These are placeholder IDs (not real WebSockets). Cleared when bubble expires.
    """
    r = _client()
    key = _members_key(bubble_id)
    for i in range(count):
        r.sadd(key, f"{prefix}:{bubble_id}:{i}")
    r.expire(key, MEMBERSHIP_TTL_SECONDS)
    return int(r.scard(key))
