from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from django.views.static import serve

from .views import ChatShellView, PrivacyPolicyView, TermsOfServiceView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("bubbles.urls")),
    path("api/", include("sessions_app.urls")),
    path("privacy/", PrivacyPolicyView.as_view(), name="privacy-policy"),
    path("terms/", TermsOfServiceView.as_view(), name="terms-of-service"),
    path("", ChatShellView.as_view(), name="home"),
    path("bubble/<uuid:bubble_id>/", ChatShellView.as_view(), name="bubble-page"),
    path("question/<uuid:question_id>/", ChatShellView.as_view(), name="question-page"),
]

if settings.MEDIA_URL and settings.MEDIA_ROOT:
    urlpatterns += [
        path(
            f"{settings.MEDIA_URL.lstrip('/')}/<path:path>",
            serve,
            {"document_root": settings.MEDIA_ROOT},
        ),
    ]
