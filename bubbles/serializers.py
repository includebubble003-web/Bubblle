from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from .models import Bubble, Message


class BubbleCreateSerializer(serializers.ModelSerializer):
    """Create bubble: title + coordinates only; radius and expiry use server defaults."""

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
        seconds = int(getattr(settings, "BUBBLLE_DEFAULT_EXPIRES_SECONDS", 23 * 60))
        radius = int(getattr(settings, "BUBBLLE_DEFAULT_RADIUS_M", 5000))
        validated_data["radius"] = radius
        validated_data["expires_at"] = timezone.now() + timedelta(seconds=seconds)
        validated_data["active"] = True
        return Bubble.objects.create(**validated_data)


class MessageCreateSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000, allow_blank=False, trim_whitespace=True)
    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)


class MessageOutSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ("id", "anonymous_name", "message", "created_at")
