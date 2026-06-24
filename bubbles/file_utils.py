"""Validate and store chat PDF attachments."""
from __future__ import annotations

import re
import uuid
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile

PDF_MAGIC = b"%PDF"
ALLOWED_PDF_CONTENT_TYPES = frozenset({"application/pdf", "application/x-pdf"})


def _max_pdf_bytes() -> int:
    return int(getattr(settings, "BUBBLLE_PDF_MAX_BYTES", 10 * 1024 * 1024))


def chat_pdf_upload_path(bubble_id: uuid.UUID | str) -> str:
    return f"chat/{bubble_id}/{uuid.uuid4().hex}.pdf"


def _safe_pdf_filename(name: str) -> str:
    base = Path(name or "document.pdf").name
    base = re.sub(r"[^\w.\- ()]", "_", base).strip("._")
    if not base.lower().endswith(".pdf"):
        base = f"{base}.pdf" if base else "document.pdf"
    return base[:255]


def validate_chat_pdf(uploaded_file) -> tuple[ContentFile, str, int]:
    """
    Validate PDF upload (size, magic bytes, content type).
    Returns (content_file, display_name, size_bytes).
    """
    size = int(getattr(uploaded_file, "size", 0) or 0)
    if size <= 0:
        raise ValueError("Empty file.")
    if size > _max_pdf_bytes():
        raise ValueError(f"PDF too large (max {_max_pdf_bytes() // (1024 * 1024)} MB).")

    content_type = (getattr(uploaded_file, "content_type", "") or "").lower()
    if content_type and content_type not in ALLOWED_PDF_CONTENT_TYPES:
        raise ValueError("Only PDF files are supported.")

    uploaded_file.seek(0)
    header = uploaded_file.read(5)
    uploaded_file.seek(0)
    if not header.startswith(PDF_MAGIC):
        raise ValueError("Invalid PDF file.")

    raw = uploaded_file.read()
    uploaded_file.seek(0)
    display_name = _safe_pdf_filename(getattr(uploaded_file, "name", "") or "document.pdf")
    storage_name = f"{uuid.uuid4().hex}.pdf"
    return ContentFile(raw, name=storage_name), display_name, len(raw)
