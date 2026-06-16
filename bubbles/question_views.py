"""REST API for anonymous local Q&A."""
from __future__ import annotations

from uuid import UUID

from django.db.models import Count
from django.utils import timezone
from django_ratelimit.decorators import ratelimit
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from sessions_app.models import AnonymousSession

from .models import Bubble, Question, Reply
from .serializers import (
    QuestionCreateSerializer,
    QuestionOutSerializer,
    ReplyCreateSerializer,
    ReplyOutSerializer,
)
from .services import (
    haversine_distance_m,
    question_search_radius_m,
    rank_question_summaries,
    serialize_question_summary,
    throttle_allow,
)
from .views import _anonymous_session_for_request, _parse_coord


def _questions_nearby_queryset():
    return (
        Question.objects.filter(active=True)
        .select_related("bubble")
        .annotate(reply_count=Count("replies"))
    )


def _filter_questions_by_radius(qs, lat: float, lng: float, search_radius_m: int):
    results: list[dict] = []
    for q in qs:
        dist = haversine_distance_m(lat, lng, q.latitude, q.longitude)
        if dist <= search_radius_m:
            summary = serialize_question_summary(q, lat, lng, reply_count=q.reply_count)
            results.append(summary)
    return rank_question_summaries(results)


@api_view(["POST"])
@ratelimit(key="ip", rate="20/h", method="POST")
def question_create(request):
    session = _anonymous_session_for_request(request)
    if not session:
        return Response(
            {"detail": "Missing anonymous session cookie."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    ser = QuestionCreateSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    data = ser.validated_data

    bubble = None
    bubble_id = data.get("bubble_id")
    if bubble_id:
        bubble = Bubble.objects.filter(id=bubble_id, active=True).first()
        if not bubble:
            return Response({"detail": "Community not found."}, status=status.HTTP_400_BAD_REQUEST)

    question = Question.objects.create(
        title=data["title"],
        description=(data.get("description") or "").strip(),
        anonymous_name=session.anonymous_name,
        latitude=data["latitude"],
        longitude=data["longitude"],
        bubble=bubble,
    )

    body = serialize_question_summary(question, data["latitude"], data["longitude"], reply_count=0)
    return Response(body, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@ratelimit(key="ip", rate="120/m", method="GET")
def questions_nearby(request):
    try:
        lat = _parse_coord(request.GET.get("lat"), "lat", -90, 90)
        lng = _parse_coord(request.GET.get("lng"), "lng", -180, 180)
        search_radius_m = int(request.GET.get("search_radius_m", str(question_search_radius_m())))
    except ValueError as e:
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    if search_radius_m < 100 or search_radius_m > 200_000:
        return Response(
            {"detail": "search_radius_m must be between 100 and 200000."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    results = _filter_questions_by_radius(_questions_nearby_queryset(), lat, lng, search_radius_m)
    return Response({"results": results})


@api_view(["GET"])
@ratelimit(key="ip", rate="120/m", method="GET")
def questions_search(request):
    query = (request.GET.get("q") or "").strip().lower()
    if len(query) < 1:
        return Response({"results": []})

    try:
        lat = _parse_coord(request.GET.get("lat"), "lat", -90, 90)
        lng = _parse_coord(request.GET.get("lng"), "lng", -180, 180)
        search_radius_m = int(request.GET.get("search_radius_m", str(question_search_radius_m())))
    except ValueError as e:
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    if search_radius_m < 100 or search_radius_m > 200_000:
        return Response(
            {"detail": "search_radius_m must be between 100 and 200000."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    qs = _questions_nearby_queryset()
    matched: list[dict] = []
    for q in qs:
        haystack = f"{q.title} {q.description}".lower()
        if query not in haystack:
            continue
        dist = haversine_distance_m(lat, lng, q.latitude, q.longitude)
        if dist <= search_radius_m:
            summary = serialize_question_summary(q, lat, lng, reply_count=q.reply_count)
            matched.append(summary)

    return Response({"results": rank_question_summaries(matched)})


@api_view(["GET"])
@ratelimit(key="ip", rate="120/m", method="GET")
def question_detail(request, question_id: UUID):
    question = (
        _questions_nearby_queryset().filter(id=question_id).first()
        or Question.objects.annotate(reply_count=Count("replies"))
        .select_related("bubble")
        .filter(id=question_id, active=True)
        .first()
    )

    if not question:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    lat_q = request.GET.get("lat")
    lng_q = request.GET.get("lng")
    if lat_q is not None and lng_q is not None:
        try:
            lat = _parse_coord(lat_q, "lat", -90, 90)
            lng = _parse_coord(lng_q, "lng", -180, 180)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        body = serialize_question_summary(
            question, lat, lng, reply_count=getattr(question, "reply_count", None)
        )
    else:
        body = {
            "id": str(question.id),
            "title": question.title,
            "description": question.description or "",
            "anonymous_name": question.anonymous_name,
            "latitude": question.latitude,
            "longitude": question.longitude,
            "reply_count": getattr(question, "reply_count", question.replies.count()),
            "created_at": question.created_at.isoformat(),
            "last_activity_at": question.last_activity_at.isoformat(),
            "bubble_id": str(question.bubble_id) if question.bubble_id else None,
            "bubble_title": question.bubble.title if question.bubble else None,
        }

    return Response(body)


@api_view(["GET", "POST"])
@ratelimit(key="ip", rate="120/m", method="GET")
@ratelimit(key="ip", rate="60/m", method="POST")
def question_replies(request, question_id: UUID):
    try:
        question = Question.objects.get(id=question_id, active=True)
    except Question.DoesNotExist:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        try:
            limit = int(request.GET.get("limit", "80"))
        except ValueError:
            limit = 80
        limit = max(1, min(limit, 100))

        qs = question.replies.order_by("-created_at")[:limit]
        items = list(reversed(list(qs)))
        ser = ReplyOutSerializer(items, many=True)
        return Response({"results": ser.data})

    session = _anonymous_session_for_request(request)
    if not session:
        return Response(
            {"detail": "Missing anonymous session cookie."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    ser = ReplyCreateSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    lat = ser.validated_data["latitude"]
    lng = ser.validated_data["longitude"]
    text = ser.validated_data["message"].strip()
    if not text:
        return Response({"detail": "Message required."}, status=status.HTTP_400_BAD_REQUEST)

    radius = question_search_radius_m()
    dist = haversine_distance_m(lat, lng, question.latitude, question.longitude)
    if dist > radius:
        return Response({"detail": "Too far from this question."}, status=status.HTTP_403_FORBIDDEN)

    throttle_key = f"bbl:qreplythrottle:{question.id}:{session.session_uuid}"
    if not throttle_allow(throttle_key, 2):
        return Response({"detail": "Slow down."}, status=status.HTTP_429_TOO_MANY_REQUESTS)

    reply = Reply.objects.create(
        question=question,
        anonymous_name=session.anonymous_name,
        message=text,
    )
    Question.objects.filter(pk=question.pk).update(last_activity_at=timezone.now())

    return Response(ReplyOutSerializer(reply).data, status=status.HTTP_201_CREATED)
