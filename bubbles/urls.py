from uuid import UUID

from django.urls import path

from . import views

urlpatterns = [
    path("bubbles/", views.bubble_create, name="api-bubble-create"),
    path("bubbles/nearby/", views.bubbles_nearby, name="api-bubbles-nearby"),
    path(
        "bubbles/messages/<uuid:message_id>/image/",
        views.message_image_file,
        name="api-message-image-file",
    ),
    path("bubbles/<uuid:bubble_id>/", views.bubble_detail, name="api-bubble-detail"),
    path("bubbles/<uuid:bubble_id>/messages/", views.bubble_messages, name="api-bubble-messages"),
    path(
        "bubbles/<uuid:bubble_id>/messages/image/",
        views.bubble_message_image,
        name="api-bubble-message-image",
    ),
]
