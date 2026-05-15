from django.contrib import admin
from django.urls import include, path
from django.views.generic import TemplateView

from .views import BubblePageView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("bubbles.urls")),
    path("api/", include("sessions_app.urls")),
    path("", TemplateView.as_view(template_name="index.html"), name="home"),
    path("bubble/<uuid:bubble_id>/", BubblePageView.as_view(), name="bubble-page"),
]
