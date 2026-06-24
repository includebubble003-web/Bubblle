from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from .models import Bubble, Message, Question, Reply
from .services import message_image_url, message_pdf_url


class BubbleCreateSerializer(serializers.ModelSerializer):
    """Create bubble: title + coordinates only; radius uses server default."""

    class Meta:
        model = Bubble
        fields = ("title", "latitude", "longitude")

    def validate_latitude(self, value: float) -> float:
        if value < -90 or value > 90:
            raise serializers.ValidationError("Latitude out of range.")
        return value

    def validate_longitude(self, value: float) -> float:
        if value < -180 or value > 180:
            raise serializers.ValidationError("Longitude out of range.")
        return value

    def create(self, validated_data: dict) -> Bubble:
        radius = int(getattr(settings, "BUBBLLE_DEFAULT_RADIUS_M", 5000))
        validated_data["radius"] = radius
        validated_data["expires_at"] = None
        validated_data["active"] = True
        return Bubble.objects.create(**validated_data)


class MessageCreateSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000, allow_blank=False, trim_whitespace=True)
    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)
    reply_to = serializers.UUIDField(required=False, allow_null=True)


class MessageImageUploadSerializer(serializers.Serializer):
    image = serializers.ImageField()
    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)
    message = serializers.CharField(
        max_length=500, required=False, allow_blank=True, trim_whitespace=True
    )
    reply_to = serializers.UUIDField(required=False, allow_null=True)


class MessagePdfUploadSerializer(serializers.Serializer):
    pdf = serializers.FileField()
    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)
    message = serializers.CharField(
        max_length=500, required=False, allow_blank=True, trim_whitespace=True
    )
    reply_to = serializers.UUIDField(required=False, allow_null=True)


class MessageOutSerializer(serializers.ModelSerializer):
    reply_to = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    pdf_url = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = (
            "id",
            "anonymous_name",
            "message",
            "created_at",
            "reply_to",
            "image_url",
            "image_width",
            "image_height",
            "pdf_url",
            "pdf_name",
            "pdf_size",
        )

    def get_image_url(self, obj: Message) -> str | None:
        return message_image_url(obj)

    def get_pdf_url(self, obj: Message) -> str | None:
        return message_pdf_url(obj)

    def get_reply_to(self, obj: Message):
        parent = getattr(obj, "reply_to", None)
        if not obj.reply_to_id or not parent:
            return None
        preview = parent.message or ""
        if not preview and parent.image:
            preview = "📷 Photo"
        elif not preview and parent.pdf:
            preview = "📄 PDF"
        out = {
            "id": str(parent.id),
            "anonymous_name": parent.anonymous_name,
            "message": preview,
        }
        reply_image_url = message_image_url(parent)
        if reply_image_url:
            out["image_url"] = reply_image_url
        reply_pdf_url = message_pdf_url(parent)
        if reply_pdf_url:
            out["pdf_url"] = reply_pdf_url
            if parent.pdf_name:
                out["pdf_name"] = parent.pdf_name
        return out


class QuestionCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200, trim_whitespace=True)
    description = serializers.CharField(
        max_length=1000, required=False, allow_blank=True, trim_whitespace=True
    )
    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)
    bubble_id = serializers.UUIDField(required=False, allow_null=True)

    def validate_title(self, value: str) -> str:
        title = value.strip()
        if len(title) < 3:
            raise serializers.ValidationError("Title must be at least 3 characters.")
        return title


class ReplyCreateSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000, trim_whitespace=True)
    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)


class ReplyOutSerializer(serializers.ModelSerializer):
    class Meta:
        model = Reply
        fields = ("id", "anonymous_name", "message", "created_at")


class QuestionOutSerializer(serializers.ModelSerializer):
    reply_count = serializers.IntegerField(read_only=True)
    distance_m = serializers.FloatField(read_only=True, required=False)
    bubble_title = serializers.CharField(source="bubble.title", read_only=True, default=None)
    bubble_id = serializers.UUIDField(source="bubble.id", read_only=True, allow_null=True)

    class Meta:
        model = Question
        fields = (
            "id",
            "title",
            "description",
            "anonymous_name",
            "latitude",
            "longitude",
            "bubble_id",
            "bubble_title",
            "created_at",
            "last_activity_at",
            "reply_count",
            "distance_m",
        )
