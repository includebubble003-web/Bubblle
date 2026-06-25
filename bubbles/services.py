"""
Geo + Redis helpers for the MVP (Haversine, no PostGIS).
"""
from __future__ import annotations

import math
from uuid import UUID

from django.conf import settings
from django.utils import timezone

from .membership import membership_count
from .models import Bubble, Message, Question, Reply


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


def message_pdf_api_path(msg: Message) -> str | None:
    if not msg.pdf or not msg.pdf.name:
        return None
    return f"/api/bubbles/messages/{msg.id}/pdf/"


def message_pdf_url(msg: Message) -> str | None:
    return public_media_url(message_pdf_api_path(msg))


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
    pdf_url = message_pdf_url(msg)
    if pdf_url:
        payload["pdf_url"] = pdf_url
        if msg.pdf_name:
            payload["pdf_name"] = msg.pdf_name
        if msg.pdf_size:
            payload["pdf_size"] = msg.pdf_size
    parent = getattr(msg, "reply_to", None)
    if msg.reply_to_id and parent:
        reply_preview = parent.message or ""
        if not reply_preview and parent.image:
            reply_preview = "📷 Photo"
        elif not reply_preview and parent.pdf:
            reply_preview = "📄 PDF"
        reply_payload = {
            "id": str(parent.id),
            "anonymous_name": parent.anonymous_name,
            "message": reply_preview,
            "image_url": message_image_url(parent),
        }
        parent_pdf_url = message_pdf_url(parent)
        if parent_pdf_url:
            reply_payload["pdf_url"] = parent_pdf_url
            if parent.pdf_name:
                reply_payload["pdf_name"] = parent.pdf_name
        payload["reply_to"] = reply_payload
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
    users = active_user_count(bubble.id) if bubble.is_joinable() else 0
    return {
        "type": "community",
        "id": str(bubble.id),
        "title": bubble.title,
        "latitude": bubble.latitude,
        "longitude": bubble.longitude,
        "radius": bubble.radius,
        "distance_m": round(dist, 1),
        "active": bubble.is_joinable(),
        "active_users": users,
        "online_count": users,  # legacy alias for older clients
    }


def serialize_question_summary(
    question: Question,
    viewer_lat: float,
    viewer_lng: float,
    *,
    reply_count: int | None = None,
) -> dict:
    dist = haversine_distance_m(viewer_lat, viewer_lng, question.latitude, question.longitude)
    count = reply_count if reply_count is not None else question.replies.count()
    bubble = question.bubble
    return {
        "type": "question",
        "id": str(question.id),
        "title": question.title,
        "description": question.description or "",
        "anonymous_name": question.anonymous_name,
        "latitude": question.latitude,
        "longitude": question.longitude,
        "distance_m": round(dist, 1),
        "reply_count": count,
        "created_at": question.created_at.isoformat(),
        "last_activity_at": question.last_activity_at.isoformat(),
        "bubble_id": str(bubble.id) if bubble else None,
        "bubble_title": bubble.title if bubble else None,
    }


def rank_question_summaries(summaries: list[dict]) -> list[dict]:
    """Local-first: distance, then recent activity, then reply count."""

    def activity_ts(item: dict) -> float:
        raw = item.get("last_activity_at") or item.get("created_at") or ""
        try:
            from datetime import datetime

            return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp()
        except (TypeError, ValueError):
            return 0.0

    return sorted(
        summaries,
        key=lambda item: (
            item.get("distance_m", 0),
            -activity_ts(item),
            -(item.get("reply_count") or 0),
        ),
    )


def question_search_radius_m() -> int:
    return int(getattr(settings, "BUBBLLE_DEFAULT_RADIUS_M", 5000))
