from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.conf import settings

from sessions_app.models import AnonymousSession


def _parse_cookies(cookie_header: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if not cookie_header:
        return out
    for part in cookie_header.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k.strip()] = v.strip()
    return out


class SessionAuthMiddleware(BaseMiddleware):
    """
    Attach anonymous identity from `BUBBLLE_SESSION_COOKIE_NAME` to the websocket scope.
    Identity must already exist in DB (created via `GET /api/me/`).
    """

    async def __call__(self, scope, receive, send):
        scope = dict(scope)
        scope["bubblle_session_uuid"] = None
        scope["bubblle_anonymous_name"] = None

        if scope["type"] == "websocket":
            headers = {
                k.decode("latin1").lower(): v.decode("latin1") for k, v in scope.get("headers", [])
            }
            cookie_header = headers.get("cookie", "")
            cookies = _parse_cookies(cookie_header)
            name = getattr(settings, "BUBBLLE_SESSION_COOKIE_NAME", "bbl_anon")
            raw = cookies.get(name, "")

            if raw:
                session = await _lookup_session(raw)
                if session:
                    scope["bubblle_session_uuid"] = str(session.session_uuid)
                    scope["bubblle_anonymous_name"] = session.anonymous_name

        return await self.inner(scope, receive, send)


@database_sync_to_async
def _lookup_session(raw: str) -> AnonymousSession | None:
    import uuid as uuid_mod

    try:
        uid = uuid_mod.UUID(str(raw))
    except (ValueError, TypeError):
        return None
    return AnonymousSession.objects.filter(session_uuid=uid).first()


def SessionCookieAuthMiddlewareStack(inner):
    return SessionAuthMiddleware(inner)
