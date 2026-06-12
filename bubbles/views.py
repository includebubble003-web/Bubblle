from __future__ import annotations

import mimetypes
from datetime import timedelta
from uuid import UUID

from django.conf import settings
from django.http import FileResponse
from django.utils import timezone
from django_ratelimit.decorators import ratelimit
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from sessions_app.models import AnonymousSession

from .models import Bubble, Message
from .serializers import (
    BubbleCreateSerializer,
    MessageCreateSerializer,
    MessageImageUploadSerializer,
    MessageOutSerializer,
)
from .image_utils import chat_image_upload_path, optimize_chat_image
from .similarity import is_similar_enough, similar_bubble_score
from .services import (
    active_user_count,
    broadcast_message,
    get_reply_parent,
    haversine_distance_m,
    serialize_bubble_summary,
    throttle_allow,
)


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

    qs = Bubble.objects.filter(active=True).only(
        "id",
        "title",
        "latitude",
        "longitude",
        "radius",
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
def bubbles_similar(request):
    """Find active nearby bubbles with similar titles to reduce fragmentation."""
    query = (request.GET.get("q") or "").strip()
    if len(query) < 2:
        return Response({"results": []})

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

    qs = Bubble.objects.filter(active=True).only(
        "id",
        "title",
        "latitude",
        "longitude",
        "radius",
        "active",
        "created_at",
    )

    scored: list[dict] = []
    for b in qs:
        dist = haversine_distance_m(lat, lng, b.latitude, b.longitude)
        if dist > search_radius_m:
            continue
        score = similar_bubble_score(query, b.title)
        if not is_similar_enough(score):
            continue
        summary = serialize_bubble_summary(b, lat, lng)
        summary["similarity_score"] = round(score, 2)
        scored.append(summary)

    scored.sort(
        key=lambda r: (
            -r["similarity_score"],
            -(r.get("active_users") or 0),
            r["distance_m"],
        )
    )
    return Response({"results": scored[:6]})


@api_view(["GET"])
@ratelimit(key="ip", rate="120/m", method="GET")
def bubble_detail(request, bubble_id: UUID):
    """Bubble metadata; optional `lat`/`lng` to include distance from viewer."""
    try:
        bubble = Bubble.objects.get(id=bubble_id)
    except Bubble.DoesNotExist:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

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

        qs = (
            Message.objects.filter(bubble=bubble)
            .select_related("reply_to")
            .order_by("-created_at")[:limit]
        )
        items = list(reversed(list(qs)))
        ser = MessageOutSerializer(items, many=True, context={"request": request})
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
    reply_to_id = ser.validated_data.get("reply_to")
    parent = get_reply_parent(bubble.id, reply_to_id) if reply_to_id else None
    if reply_to_id and not parent:
        return Response({"detail": "Reply target not found."}, status=status.HTTP_400_BAD_REQUEST)

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
        reply_to=parent,
    )
    msg = Message.objects.select_related("reply_to").get(pk=msg.pk)

    broadcast_message(bubble.id, msg)

    return Response(
        MessageOutSerializer(msg, context={"request": request}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@ratelimit(key="ip", rate="240/m", method="GET")
def message_image_file(request, message_id: UUID):
    """Serve a chat photo through the API (reliable behind Docker/nginx)."""
    try:
        msg = Message.objects.get(id=message_id)
    except Message.DoesNotExist:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    if not msg.image or not msg.image.name:
        return Response({"detail": "No image."}, status=status.HTTP_404_NOT_FOUND)

    content_type, _ = mimetypes.guess_type(msg.image.name)
    try:
        img_file = msg.image.open("rb")
    except OSError:
        return Response({"detail": "Image file missing."}, status=status.HTTP_404_NOT_FOUND)

    response = FileResponse(img_file, content_type=content_type or "image/jpeg")
    response["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


@api_view(["POST"])
@ratelimit(key="ip", rate="30/m", method="POST")
def bubble_message_image(request, bubble_id: UUID):
    """Upload a photo (gallery or camera); optimized to JPEG server-side."""
    session = _anonymous_session_for_request(request)
    if not session:
        return Response({"detail": "Missing anonymous session cookie."}, status=status.HTTP_401_UNAUTHORIZED)

    try:
        bubble = Bubble.objects.get(id=bubble_id)
    except Bubble.DoesNotExist:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    if not bubble.is_joinable():
        return Response({"detail": "Bubble is not active."}, status=status.HTTP_410_GONE)

    ser = MessageImageUploadSerializer(data=request.data)
    ser.is_valid(raise_exception=True)

    lat = ser.validated_data["latitude"]
    lng = ser.validated_data["longitude"]
    caption = (ser.validated_data.get("message") or "").strip()
    reply_to_id = ser.validated_data.get("reply_to")
    parent = get_reply_parent(bubble.id, reply_to_id) if reply_to_id else None
    if reply_to_id and not parent:
        return Response({"detail": "Reply target not found."}, status=status.HTTP_400_BAD_REQUEST)

    dist = haversine_distance_m(lat, lng, bubble.latitude, bubble.longitude)
    if dist > bubble.radius:
        return Response({"detail": "Outside bubble radius."}, status=status.HTTP_403_FORBIDDEN)

    throttle_key = f"bbl:imgthrottle:{bubble.id}:{session.session_uuid}"
    if not throttle_allow(throttle_key, 3):
        return Response({"detail": "Slow down."}, status=status.HTTP_429_TOO_MANY_REQUESTS)

    try:
        optimized, width, height = optimize_chat_image(ser.validated_data["image"])
    except ValueError as e:
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    settings.MEDIA_ROOT.mkdir(parents=True, exist_ok=True)

    msg = Message(
        bubble=bubble,
        anonymous_name=session.anonymous_name,
        message=caption,
        reply_to=parent,
        image_width=width,
        image_height=height,
    )
    msg.image.save(chat_image_upload_path(bubble.id), optimized, save=False)
    msg.save()
    msg = Message.objects.select_related("reply_to").get(pk=msg.pk)

    broadcast_message(bubble.id, msg)

    return Response(
        MessageOutSerializer(msg, context={"request": request}).data,
        status=status.HTTP_201_CREATED,
    )
