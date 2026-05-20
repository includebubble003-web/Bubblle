from django.contrib import admin

from .models import Bubble, Message


@admin.register(Bubble)
class BubbleAdmin(admin.ModelAdmin):
    list_display = ("title", "latitude", "longitude", "radius", "expires_at", "active", "created_at")
    list_filter = ("active",)
    search_fields = ("title", "id")


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("bubble", "anonymous_name", "reply_to", "created_at")
    search_fields = ("message", "anonymous_name")
    raw_id_fields = ("reply_to",)
