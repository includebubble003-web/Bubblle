from uuid import UUID

from django.urls import path

from . import question_views, views

urlpatterns = [
    path("bubbles/", views.bubble_create, name="api-bubble-create"),
    path("bubbles/nearby/", views.bubbles_nearby, name="api-bubbles-nearby"),
    path("bubbles/similar/", views.bubbles_similar, name="api-bubbles-similar"),
    path("questions/", question_views.question_create, name="api-question-create"),
    path("questions/nearby/", question_views.questions_nearby, name="api-questions-nearby"),
    path("questions/search/", question_views.questions_search, name="api-questions-search"),
    path("questions/<uuid:question_id>/", question_views.question_detail, name="api-question-detail"),
    path(
        "questions/<uuid:question_id>/replies/",
        question_views.question_replies,
        name="api-question-replies",
    ),
    path(
        "bubbles/messages/<uuid:message_id>/image/",
        views.message_image_file,
        name="api-message-image-file",
    ),
    path(
        "bubbles/messages/<uuid:message_id>/pdf/",
        views.message_pdf_file,
        name="api-message-pdf-file",
    ),
    path("bubbles/<uuid:bubble_id>/", views.bubble_detail, name="api-bubble-detail"),
    path("bubbles/<uuid:bubble_id>/messages/", views.bubble_messages, name="api-bubble-messages"),
    path(
        "bubbles/<uuid:bubble_id>/messages/image/",
        views.bubble_message_image,
        name="api-bubble-message-image",
    ),
    path(
        "bubbles/<uuid:bubble_id>/messages/pdf/",
        views.bubble_message_pdf,
        name="api-bubble-message-pdf",
    ),
]
