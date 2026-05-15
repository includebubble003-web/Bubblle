from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.me, name="api-me"),
    path("health/", views.health, name="api-health"),
]
