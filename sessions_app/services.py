import random
import uuid

from django.conf import settings

from .models import AnonymousSession

_ADJECTIVES = (
    "Silent",
    "Swift",
    "Misty",
    "Cosmic",
    "Neon",
    "Urban",
    "Crystal",
    "Golden",
    "Shadow",
    "Bright",
    "Calm",
    "Wild",
    "Tiny",
    "Brave",
    "Lucky",
)

_ANIMALS = (
    "Tiger",
    "Fox",
    "Wolf",
    "Otter",
    "Hawk",
    "Panda",
    "Lynx",
    "Heron",
    "Badger",
    "Falcon",
    "Raven",
    "Koala",
    "Gecko",
    "Llama",
    "Finch",
)


def generate_anonymous_name() -> str:
    """Return a friendly anonymous handle, e.g. SilentTiger."""
    adj = random.choice(_ADJECTIVES)
    animal = random.choice(_ANIMALS)
    return f"{adj}{animal}"


def get_or_create_anonymous_session(session_uuid: uuid.UUID | None) -> tuple[AnonymousSession, bool]:
    """
    Look up by cookie UUID; create new session if missing or invalid.
    Returns (session, created).
    """
    if session_uuid:
        existing = AnonymousSession.objects.filter(session_uuid=session_uuid).first()
        if existing:
            return existing, False

    name = generate_anonymous_name()
    # Ensure uniqueness of display name is not required for MVP; UUID is source of truth.
    obj = AnonymousSession.objects.create(
        anonymous_name=name,
        session_uuid=uuid.uuid4(),
    )
    return obj, True


def session_cookie_name() -> str:
    return getattr(settings, "BUBBLLE_SESSION_COOKIE_NAME", "bbl_anon")
