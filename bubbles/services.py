"""
Geo + Redis helpers for the MVP (Haversine, no PostGIS).
"""
from __future__ import annotations

import math
from uuid import UUID

from django.utils import timezone

from .membership import membership_count
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


def throttle_allow(cache_key: str, cooldown_seconds: int) -> bool:
    """
    Simple Redis-backed throttle: returns False if key exists (still cooling down).
    When allowed, sets key with TTL=cooldown_seconds.
    """
    from django.core.cache import cache

    if cache.get(cache_key) is not None:
        return False
    cache.set(cache_key, "1", timeout=cooldown_seconds)
    return True


def bubble_channel_group(bubble_id: UUID | str) -> str:
    return f"bubble_{bubble_id}"


def active_user_count(bubble_id: UUID | str) -> int:
    """Connected WebSocket clients currently in the bubble."""
    return membership_count(bubble_id)


def serialize_bubble_summary(bubble: Bubble, viewer_lat: float, viewer_lng: float) -> dict:
    dist = haversine_distance_m(viewer_lat, viewer_lng, bubble.latitude, bubble.longitude)
    remaining = max(0, int((bubble.expires_at - timezone.now()).total_seconds()))
    users = active_user_count(bubble.id) if bubble.is_joinable() else 0
    return {
        "id": str(bubble.id),
        "title": bubble.title,
        "latitude": bubble.latitude,
        "longitude": bubble.longitude,
        "radius": bubble.radius,
        "distance_m": round(dist, 1),
        "expires_at": bubble.expires_at.isoformat(),
        "remaining_seconds": remaining,
        "active": bubble.is_joinable(),
        "active_users": users,
        "online_count": users,  # legacy alias for older clients
    }
