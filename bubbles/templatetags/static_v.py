from django import template
from django.conf import settings
from django.templatetags.static import static

register = template.Library()


@register.simple_tag
def static_v(path: str) -> str:
    """Static URL with deploy version query param (helps when assets are not content-hashed)."""
    url = static(path)
    version = getattr(settings, "BUBBLLE_STATIC_VERSION", "")
    if not version:
        return url
    joiner = "&" if "?" in url else "?"
    return f"{url}{joiner}v={version}"
