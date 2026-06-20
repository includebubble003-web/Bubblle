"""Generate simple demo placeholder images (no external assets)."""
from __future__ import annotations

import hashlib
import io

from django.core.files.base import ContentFile
from PIL import Image, ImageDraw, ImageFont


def _color_from_seed(seed: str) -> tuple[int, int, int]:
    digest = hashlib.sha256(seed.encode()).hexdigest()
    r = int(digest[0:2], 16)
    g = int(digest[2:4], 16)
    b = int(digest[4:6], 16)
    return (max(r, 40), max(g, 40), max(b, 40))


def make_seed_placeholder(
    label: str,
    *,
    width: int = 720,
    height: int = 540,
) -> tuple[ContentFile, int, int]:
    """
    Build a labeled JPEG placeholder for demo chat images.
    Not real user photos — clearly synthetic for product demos.
    """
    bg = _color_from_seed(label)
    accent = tuple(min(255, c + 55) for c in bg)
    img = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(img)
    draw.rectangle([24, 24, width - 24, height - 24], outline=accent, width=3)

    title = label.replace("_", " ").title()
    subtitle = "Demo placeholder"
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None

    draw.text((40, height // 2 - 28), title, fill=(245, 247, 250), font=font)
    draw.text((40, height // 2 + 4), subtitle, fill=(200, 205, 215), font=font)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=82, optimize=True)
    safe_name = "".join(ch if ch.isalnum() else "_" for ch in label.lower())[:48]
    return ContentFile(buf.getvalue(), name=f"seed_{safe_name}.jpg"), width, height
