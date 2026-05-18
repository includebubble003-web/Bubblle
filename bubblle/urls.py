from django.contrib import admin
from django.urls import include, path

from .views import ChatShellView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("bubbles.urls")),
    path("api/", include("sessions_app.urls")),
    path("", ChatShellView.as_view(), name="home"),
    path("bubble/<uuid:bubble_id>/", ChatShellView.as_view(), name="bubble-page"),
]
