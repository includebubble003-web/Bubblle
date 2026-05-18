from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from django.utils import timezone
from django_ratelimit.decorators import ratelimit
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from sessions_app.models import AnonymousSession

from .models import Bubble, Message
from .serializers import BubbleCreateSerializer, MessageCreateSerializer, MessageOutSerializer
from .membership import membership_clear
from .services import active_user_count, haversine_distance_m, serialize_bubble_summary, throttle_allow


def _anonymous_session_for_request(request) -> AnonymousSession | None:
    from django.conf import settings

    raw = request.COOKIES.get(getattr(settings, "BUBBLLE_SESSION_COOKIE_NAME", "bbl_anon"))
    if not raw:
        return None
    try:
        uid = UUID(str(raw))
    except (ValueError, TypeError):
        return None
    return AnonymousSession.objects.filter(session_uuid=uid).first()


def _parse_coord(raw: str | None, name: str, lo: float, hi: float) -> float:
    if raw is None:
        raise ValueError(f"Missing {name}")
    v = float(raw)
    if v < lo or v > hi:
        raise ValueError(f"Invalid {name}")
    return v


@api_view(["POST"])
@ratelimit(key="ip", rate="20/h", method="POST")
def bubble_create(request):
    """Create a new bubble (geofenced chat room)."""
    ser = BubbleCreateSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    bubble = ser.save()
    return Response(
        {
            "id": str(bubble.id),
            "title": bubble.title,
            "latitude": bubble.latitude,
            "longitude": bubble.longitude,
            "radius": bubble.radius,
            "expires_at": bubble.expires_at.isoformat(),
            "active": bubble.active,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@ratelimit(key="ip", rate="120/m", method="GET")
def bubbles_nearby(request):
    """List active bubbles near a coordinate with distance + online count."""
    try:
        lat = _parse_coord(request.GET.get("lat"), "lat", -90, 90)
        lng = _parse_coord(request.GET.get("lng"), "lng", -180, 180)
        search_radius_m = int(request.GET.get("search_radius_m", "10000"))
    except ValueError as e:
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    if search_radius_m < 100 or search_radius_m > 200_000:
        return Response(
            {"detail": "search_radius_m must be between 100 and 200000."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    now = timezone.now()
    qs = Bubble.objects.filter(active=True, expires_at__gt=now).only(
        "id",
        "title",
        "latitude",
        "longitude",
        "radius",
        "expires_at",
        "active",
        "created_at",
    )
    results: list[dict] = []
    for b in qs:
        dist = haversine_distance_m(lat, lng, b.latitude, b.longitude)
        if dist <= search_radius_m:
            results.append(serialize_bubble_summary(b, lat, lng))

    results.sort(key=lambda r: r["distance_m"])
    return Response({"results": results})


@api_view(["GET"])
@ratelimit(key="ip", rate="120/m", method="GET")
def bubble_detail(request, bubble_id: UUID):
    """Bubble metadata; optional `lat`/`lng` to include distance from viewer."""
    try:
        bubble = Bubble.objects.get(id=bubble_id)
    except Bubble.DoesNotExist:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    if bubble.is_expired() and bubble.active:
        bubble.active = False
        bubble.save(update_fields=["active"])
        membership_clear(bubble.id)

    lat_q = request.GET.get("lat")
    lng_q = request.GET.get("lng")
    if lat_q is not None and lng_q is not None:
        try:
            lat = _parse_coord(lat_q, "lat", -90, 90)
            lng = _parse_coord(lng_q, "lng", -180, 180)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        body = serialize_bubble_summary(bubble, lat, lng)
    else:
        users = active_user_count(bubble.id) if bubble.is_joinable() else 0
        body = {
            "id": str(bubble.id),
            "title": bubble.title,
            "latitude": bubble.latitude,
            "longitude": bubble.longitude,
            "radius": bubble.radius,
            "expires_at": bubble.expires_at.isoformat(),
            "remaining_seconds": max(0, int((bubble.expires_at - timezone.now()).total_seconds())),
            "active": bubble.is_joinable(),
            "active_users": users,
            "online_count": users,
        }

    return Response(body)


@api_view(["GET", "POST"])
@ratelimit(key="ip", rate="120/m", method="GET")
@ratelimit(key="ip", rate="60/m", method="POST")
def bubble_messages(request, bubble_id: UUID):
    """
    GET: recent messages (history / backfill).
    POST: send a message via REST (WebSocket is preferred for realtime).
    """
    try:
        bubble = Bubble.objects.get(id=bubble_id)
    except Bubble.DoesNotExist:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        if not bubble.is_joinable():
            return Response({"detail": "Bubble is not active."}, status=status.HTTP_410_GONE)

        try:
            limit = int(request.GET.get("limit", "50"))
        except ValueError:
            limit = 50
        limit = max(1, min(limit, 100))

        qs = Message.objects.filter(bubble=bubble).order_by("-created_at")[:limit]
        items = list(reversed(list(qs)))
        ser = MessageOutSerializer(items, many=True)
        return Response({"results": ser.data})

    # POST
    session = _anonymous_session_for_request(request)
    if not session:
        return Response({"detail": "Missing anonymous session cookie."}, status=status.HTTP_401_UNAUTHORIZED)

    if not bubble.is_joinable():
        return Response({"detail": "Bubble is not active."}, status=status.HTTP_410_GONE)

    ser = MessageCreateSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    lat = ser.validated_data["latitude"]
    lng = ser.validated_data["longitude"]
    text = ser.validated_data["message"].strip()

    dist = haversine_distance_m(lat, lng, bubble.latitude, bubble.longitude)
    if dist > bubble.radius:
        return Response({"detail": "Outside bubble radius."}, status=status.HTTP_403_FORBIDDEN)

    throttle_key = f"bbl:msgthrottle:{bubble.id}:{session.session_uuid}"
    if not throttle_allow(throttle_key, 1):
        return Response({"detail": "Slow down."}, status=status.HTTP_429_TOO_MANY_REQUESTS)

    msg = Message.objects.create(
        bubble=bubble,
        anonymous_name=session.anonymous_name,
        message=text,
    )

    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f"bubble_{bubble.id}",
        {
            "type": "bubble.chat",
            "message": {
                "id": str(msg.id),
                "anonymous_name": msg.anonymous_name,
                "message": msg.message,
                "created_at": msg.created_at.isoformat(),
            },
        },
    )

    return Response(MessageOutSerializer(msg).data, status=status.HTTP_201_CREATED)
