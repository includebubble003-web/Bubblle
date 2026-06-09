"""
Django settings for Bubblle MVP (anonymous geo chat).
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Load project .env (local dev). In Docker, vars come from compose env_file / environment.
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-unsafe-key-change-me")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"

ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if h.strip()
]

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "channels",
    "sessions_app",
    "bubbles",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "bubblle.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "bubblle.wsgi.application"
ASGI_APPLICATION = "bubblle.asgi.application"

# --- Database (PostgreSQL) ---
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "bubblle"),
        "USER": os.environ.get("POSTGRES_USER", "bubblle"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "bubblle"),
        "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# Chat image uploads — resized to WebP server-side
BUBBLLE_IMAGE_MAX_BYTES = int(os.environ.get("BUBBLLE_IMAGE_MAX_BYTES", str(5 * 1024 * 1024)))
BUBBLLE_IMAGE_MAX_DIMENSION = int(os.environ.get("BUBBLLE_IMAGE_MAX_DIMENSION", "1280"))
BUBBLLE_IMAGE_WEBP_QUALITY = int(os.environ.get("BUBBLLE_IMAGE_WEBP_QUALITY", "80"))

# In DEBUG, serve from app static dirs without running collectstatic; in prod, use STATIC_ROOT (Docker build).
WHITENOISE_USE_FINDERS = DEBUG
WHITENOISE_MAX_AGE = 60 * 60 * 24 * 30 if not DEBUG else 0

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Redis: Channels layer + django-ratelimit cache ---
REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [REDIS_URL],
        },
    }
}

# django-ratelimit uses default cache
RATELIMIT_USE_CACHE = "default"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.AllowAny",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
        "rest_framework.parsers.FormParser",
    ],
}

# Bubble defaults (create API — not exposed in UI)
BUBBLLE_DEFAULT_RADIUS_M = 5_000  # 5 km geofence
BUBBLLE_DEFAULT_EXPIRES_SECONDS = 23 * 60  # 23 minutes (user-created bubbles)
# Demo seed + AI agents — long-lived so agents survive restarts (override via .env)
BUBBLLE_DEMO_EXPIRES_SECONDS = int(
    os.environ.get("BUBBLLE_DEMO_EXPIRES_SECONDS", str(24 * 60 * 60))
)

# Django session cookie (CSRF / admin). Kept separate from anonymous chat identity.
BUBBLLE_SESSION_COOKIE_NAME = "bbl_anon"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "0") == "1"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 365  # 1 year

CSRF_TRUSTED_ORIGINS = []
for host in ALLOWED_HOSTS:
    if host not in ("localhost", "127.0.0.1", "0.0.0.0"):
        CSRF_TRUSTED_ORIGINS.append(f"https://{host}")
        CSRF_TRUSTED_ORIGINS.append(f"http://{host}")

# Full URLs for ALB / CloudFront (e.g. https://app.example.com,https://www.example.com)
_extra_origins = os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "")
if _extra_origins.strip():
    CSRF_TRUSTED_ORIGINS.extend(
        o.strip() for o in _extra_origins.split(",") if o.strip()
    )

# --- OpenAI (demo AI chat agents; key from .env via load_dotenv above) ---
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini").strip()
BUBBLLE_BASE_URL = os.environ.get("BUBBLLE_BASE_URL", "http://127.0.0.1:8000").strip().rstrip("/")
BUBBLLE_AI_BOTS_PER_BUBBLE = int(os.environ.get("BUBBLLE_AI_BOTS_PER_BUBBLE", "1"))
BUBBLLE_AI_POLL_SECONDS = int(os.environ.get("BUBBLLE_AI_POLL_SECONDS", "30"))
BUBBLLE_AI_REPLY_DELAY_MIN = int(os.environ.get("BUBBLLE_AI_REPLY_DELAY_MIN", "10"))
BUBBLLE_AI_REPLY_DELAY_MAX = int(os.environ.get("BUBBLLE_AI_REPLY_DELAY_MAX", "10"))
BUBBLLE_AI_REPLY_MIN_GAP = int(os.environ.get("BUBBLLE_AI_REPLY_MIN_GAP", "10"))
