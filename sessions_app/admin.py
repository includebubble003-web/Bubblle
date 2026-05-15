from django.contrib import admin

from .models import AnonymousSession


@admin.register(AnonymousSession)
class AnonymousSessionAdmin(admin.ModelAdmin):
    list_display = ("anonymous_name", "session_uuid", "created_at")
    search_fields = ("anonymous_name", "session_uuid")
