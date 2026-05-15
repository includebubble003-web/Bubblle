import uuid

from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET
from django_ratelimit.decorators import ratelimit
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .services import get_or_create_anonymous_session, session_cookie_name


def _parse_uuid(raw: str | None) -> uuid.UUID | None:
    if not raw:
        return None
    try:
        return uuid.UUID(str(raw))
    except (ValueError, TypeError):
        return None


@api_view(["GET"])
@ratelimit(key="ip", rate="60/m", method="GET")
def me(request):
    """
    Return (and optionally create) the anonymous session.
    Sets HttpOnly cookie with `session_uuid` for WebSocket + API continuity.
    """
    cookie_name = session_cookie_name()
    raw = request.COOKIES.get(cookie_name)
    sid = _parse_uuid(raw)
    session, created = get_or_create_anonymous_session(sid)

    data = {
        "anonymous_name": session.anonymous_name,
        "session_uuid": str(session.session_uuid),
        "created": created,
    }
    resp = Response(data)
    # Refresh cookie on every call so TTL slides forward (browser session persistence via max_age).
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


@csrf_exempt
@require_GET
@ratelimit(key="ip", rate="120/m", method="GET")
def health(request):
    """Plain HTTP health check for load balancers."""
    return HttpResponse("ok")
