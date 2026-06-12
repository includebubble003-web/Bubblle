from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from .models import Bubble, Message
from .services import message_image_url


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


class MessageOutSerializer(serializers.ModelSerializer):
    reply_to = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()

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
        )

    def get_image_url(self, obj: Message) -> str | None:
        return message_image_url(obj)

    def get_reply_to(self, obj: Message):
        parent = getattr(obj, "reply_to", None)
        if not obj.reply_to_id or not parent:
            return None
        preview = parent.message or ""
        if not preview and parent.image:
            preview = "📷 Photo"
        out = {
            "id": str(parent.id),
            "anonymous_name": parent.anonymous_name,
            "message": preview,
        }
        reply_image_url = message_image_url(parent)
        if reply_image_url:
            out["image_url"] = reply_image_url
        return out
