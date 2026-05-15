"""
Geo + Redis helpers for the MVP (Haversine, no PostGIS).
"""
from __future__ import annotations

import math
from uuid import UUID

from django.core.cache import cache
from django.utils import timezone

from .models import Bubble


def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two WGS84 points in meters."""
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return r * c


def redis_online_key(bubble_id: UUID | str) -> str:
    return f"bbl:bubble:{bubble_id}:online"


def online_count_get(bubble_id: UUID | str) -> int:
    v = cache.get(redis_online_key(bubble_id))
    try:
        return int(v) if v is not None else 0
    except (TypeError, ValueError):
        return 0


def online_count_incr(bubble_id: UUID | str) -> int:
    key = redis_online_key(bubble_id)
    try:
        return int(cache.incr(key))
    except ValueError:
        cache.set(key, 1, timeout=86400)
        return 1


def online_count_decr(bubble_id: UUID | str) -> int:
    key = redis_online_key(bubble_id)
    try:
        n = int(cache.decr(key))
    except ValueError:
        return 0
    if n < 0:
        cache.set(key, 0, timeout=86400)
        return 0
    return n


def throttle_allow(cache_key: str, cooldown_seconds: int) -> bool:
    """
    Simple Redis-backed throttle: returns False if key exists (still cooling down).
    When allowed, sets key with TTL=cooldown_seconds.
    """
    if cache.get(cache_key) is not None:
        return False
    cache.set(cache_key, "1", timeout=cooldown_seconds)
    return True


def bubble_channel_group(bubble_id: UUID | str) -> str:
    return f"bubble_{bubble_id}"


def serialize_bubble_summary(bubble: Bubble, viewer_lat: float, viewer_lng: float) -> dict:
    dist = haversine_distance_m(viewer_lat, viewer_lng, bubble.latitude, bubble.longitude)
    remaining = max(0, int((bubble.expires_at - timezone.now()).total_seconds()))
    return {
        "id": str(bubble.id),
        "title": bubble.title,
        "latitude": bubble.latitude,
        "longitude": bubble.longitude,
        "radius": bubble.radius,
        "distance_m": round(dist, 1),
        "expires_at": bubble.expires_at.isoformat(),
        "remaining_seconds": remaining,
        "active": bubble.active and not bubble.is_expired(),
        "online_count": online_count_get(bubble.id),
    }
