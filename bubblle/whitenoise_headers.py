"""
WhiteNoise response headers for static assets.

Hashed filenames (from collectstatic manifest) → long immutable cache.
Unhashed JS/CSS (ES module subgraph) → revalidate every load so deploys propagate.
"""
from __future__ import annotations

import re

# e.g. chat-app.3d65f550d282.js, map.d05041f6f9eb.css
HASHED_STATIC_RE = re.compile(r"\.[0-9a-f]{8,}\.[a-z0-9]+$", re.IGNORECASE)

IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
REVALIDATE_CACHE = "no-cache, must-revalidate"


def _basename(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def is_content_hashed_static(path: str, url: str = "") -> bool:
    return bool(
        HASHED_STATIC_RE.search(_basename(path))
        or (url and HASHED_STATIC_RE.search(_basename(url.split("?", 1)[0])))
    )


def whitenoise_add_headers(headers: dict, path: str, url: str) -> None:
    """Hook for WHITENOISE_ADD_HEADERS_FUNCTION."""
    lower = path.lower()
    if not (lower.endswith(".js") or lower.endswith(".css")):
        return

    if is_content_hashed_static(path):
        headers["Cache-Control"] = IMMUTABLE_CACHE
    else:
        # ES module imports resolve to unhashed paths — never cache aggressively.
        headers["Cache-Control"] = REVALIDATE_CACHE
        headers["Pragma"] = "no-cache"
