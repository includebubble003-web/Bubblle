from django.views.generic import TemplateView


class ChatShellView(TemplateView):
    """Unified chat UI: sidebar bubbles + main chat area."""

    template_name = "chat_shell.html"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        bid = self.kwargs.get("bubble_id")
        ctx["bubble_id"] = str(bid) if bid else ""
        return ctx


class PrivacyPolicyView(TemplateView):
    template_name = "legal/privacy_policy.html"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx["legal_page"] = "privacy"
        return ctx


class TermsOfServiceView(TemplateView):
    template_name = "legal/terms_of_service.html"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx["legal_page"] = "terms"
        return ctx
