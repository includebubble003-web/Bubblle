"""Cache-Control for dynamic HTML and API responses."""


class CacheControlMiddleware:
    """
    - API: no-store (live bubbles, questions, chat).
    - HTML shell pages: no-cache (must pick up new {% static %} URLs after deploy).
  Static files are handled by WhiteNoise + whitenoise_add_headers.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        path = request.path

        if path.startswith("/api/"):
            response["Cache-Control"] = "no-store, no-cache, must-revalidate"
            response["Pragma"] = "no-cache"
            return response

        if path.startswith("/static/") or path.startswith("/admin/"):
            return response

        content_type = (response.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type == "text/html":
            response["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response["Pragma"] = "no-cache"
            response["Expires"] = "0"

        return response
