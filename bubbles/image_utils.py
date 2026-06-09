"""Resize, compress, and store chat images as JPEG."""
from __future__ import annotations

import io
import uuid

from django.conf import settings
from django.core.files.base import ContentFile

from PIL import Image, ImageOps

ALLOWED_INPUT_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"}
)


def _max_dimension() -> int:
    return int(getattr(settings, "BUBBLLE_IMAGE_MAX_DIMENSION", 1280))


def _max_input_bytes() -> int:
    return int(getattr(settings, "BUBBLLE_IMAGE_MAX_BYTES", 5 * 1024 * 1024))


def _jpeg_quality() -> int:
    return int(
        getattr(
            settings,
            "BUBBLLE_IMAGE_JPEG_QUALITY",
            getattr(settings, "BUBBLLE_IMAGE_WEBP_QUALITY", 82),
        )
    )


def chat_image_upload_path(bubble_id: uuid.UUID | str) -> str:
    return f"chat/{bubble_id}/{uuid.uuid4().hex}.jpg"


def optimize_chat_image(uploaded_file) -> tuple[ContentFile, int, int]:
    """
    Strip EXIF, auto-orient, resize, encode JPEG.
    Returns (file, width, height).
    """
    if uploaded_file.size > _max_input_bytes():
        raise ValueError(f"Image too large (max {_max_input_bytes() // (1024 * 1024)} MB).")

    content_type = (getattr(uploaded_file, "content_type", "") or "").lower()
    if content_type and content_type not in ALLOWED_INPUT_TYPES:
        raise ValueError("Unsupported image type.")

    uploaded_file.seek(0)
    try:
        img = Image.open(uploaded_file)
        img = ImageOps.exif_transpose(img)
    except Exception as exc:
        raise ValueError("Invalid image file.") from exc

    if img.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", img.size, (11, 16, 24))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if "A" in img.mode else None)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    max_dim = _max_dimension()
    img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    width, height = img.size

    quality = _jpeg_quality()
    buf = io.BytesIO()
    for _ in range(4):
        buf.seek(0)
        buf.truncate(0)
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        if buf.tell() <= 600_000 or quality <= 55:
            break
        quality -= 8

    name = f"{uuid.uuid4().hex}.jpg"
    return ContentFile(buf.getvalue(), name=name), width, height
