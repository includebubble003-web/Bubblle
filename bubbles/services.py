"""
Geo + Redis helpers for the MVP (Haversine, no PostGIS).
"""
from __future__ import annotations

import math
from uuid import UUID

from django.conf import settings
from django.utils import timezone

from .membership import membership_count
from .models import Bubble, Message


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


def public_media_url(relative_url: str | None) -> str | None:
    """Turn /media/... into an absolute URL for clients (WebSocket + REST)."""
    if not relative_url:
        return None
    if relative_url.startswith(("http://", "https://")):
        return relative_url
    base = getattr(settings, "BUBBLLE_PUBLIC_BASE_URL", "").rstrip("/")
    if not base:
        return relative_url
    return f"{base}{relative_url}" if relative_url.startswith("/") else f"{base}/{relative_url}"


def message_image_api_path(msg: Message) -> str | None:
    """Stable API path for chat photos (served by Django, not /media/ static)."""
    if not msg.image or not msg.image.name:
        return None
    return f"/api/bubbles/messages/{msg.id}/image/"


def message_image_url(msg: Message) -> str | None:
    return public_media_url(message_image_api_path(msg))


def get_reply_parent(bubble_id: UUID, reply_to_id: UUID | None) -> Message | None:
    """Resolve a reply target; must belong to the same bubble."""
    if not reply_to_id:
        return None
    return Message.objects.filter(id=reply_to_id, bubble_id=bubble_id).select_related("reply_to").first()


def serialize_message(msg: Message) -> dict:
    """Wire + REST payload for a chat line (includes optional reply preview)."""
    payload = {
        "id": str(msg.id),
        "anonymous_name": msg.anonymous_name,
        "message": msg.message or "",
        "created_at": msg.created_at.isoformat(),
    }
    image_url = message_image_url(msg)
    if image_url:
        payload["image_url"] = image_url
        if msg.image_width:
            payload["image_width"] = msg.image_width
        if msg.image_height:
            payload["image_height"] = msg.image_height
    parent = getattr(msg, "reply_to", None)
    if msg.reply_to_id and parent:
        reply_preview = parent.message or ""
        if not reply_preview and parent.image:
            reply_preview = "📷 Photo"
        payload["reply_to"] = {
            "id": str(parent.id),
            "anonymous_name": parent.anonymous_name,
            "message": reply_preview,
            "image_url": message_image_url(parent),
        }
    return payload


def broadcast_message(bubble_id: UUID | str, msg: Message) -> None:
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        bubble_channel_group(bubble_id),
        {"type": "bubble.chat", "message": serialize_message(msg)},
    )


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
