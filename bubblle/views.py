from django.views.generic import TemplateView


class BubblePageView(TemplateView):
    """Serve SPA-style bubble chat shell with UUID in template context."""

    template_name = "bubble.html"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx["bubble_id"] = self.kwargs["bubble_id"]
        return ctx
