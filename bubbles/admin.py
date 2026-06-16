from django.contrib import admin

from .models import Bubble, Message, Question, Reply


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


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ("title", "anonymous_name", "bubble", "reply_count_display", "active", "created_at")
    list_filter = ("active",)
    search_fields = ("title", "description", "id")
    raw_id_fields = ("bubble",)

    @admin.display(description="Replies")
    def reply_count_display(self, obj: Question) -> int:
        return obj.replies.count()


@admin.register(Reply)
class ReplyAdmin(admin.ModelAdmin):
    list_display = ("question", "anonymous_name", "created_at")
    search_fields = ("message", "anonymous_name")
    raw_id_fields = ("question",)
