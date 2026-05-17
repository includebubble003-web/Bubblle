import uuid

from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET
from django_ratelimit.decorators import ratelimit
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .serializers import AnonymousNameSerializer
from .services import get_or_create_anonymous_session, session_cookie_name


def _parse_uuid(raw: str | None) -> uuid.UUID | None:
    if not raw:
        return None
    try:
        return uuid.UUID(str(raw))
    except (ValueError, TypeError):
        return None


def _session_response(request, session, created: bool = False):
    cookie_name = session_cookie_name()
    data = {
        "anonymous_name": session.anonymous_name,
        "session_uuid": str(session.session_uuid),
        "created": created,
    }
    resp = Response(data)
    resp.set_cookie(
        key=cookie_name,
        value=str(session.session_uuid),
        max_age=settings.SESSION_COOKIE_AGE,
        httponly=True,
        samesite=settings.SESSION_COOKIE_SAMESITE,
        secure=settings.SESSION_COOKIE_SECURE,
        path="/",
    )
    return resp


def _session_from_request(request):
    cookie_name = session_cookie_name()
    raw = request.COOKIES.get(cookie_name)
    sid = _parse_uuid(raw)
    return get_or_create_anonymous_session(sid)


@api_view(["GET", "PATCH"])
@ratelimit(key="ip", rate="60/m", method="GET")
@ratelimit(key="ip", rate="30/m", method="PATCH")
def me(request):
    """
    GET: return (and optionally create) the anonymous session; sets `bbl_anon` cookie.
    PATCH: set display name `{ "anonymous_name": "..." }`.
    """
    session, created = _session_from_request(request)

    if request.method == "PATCH":
        ser = AnonymousNameSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        session.anonymous_name = ser.validated_data["anonymous_name"]
        session.save(update_fields=["anonymous_name"])
        return _session_response(request, session, created=False)

    return _session_response(request, session, created=created)


@csrf_exempt
@require_GET
@ratelimit(key="ip", rate="120/m", method="GET")
def health(request):
    """Plain HTTP health check for load balancers."""
    return HttpResponse("ok")
