from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from .models import Bubble, Message


class BubbleCreateSerializer(serializers.ModelSerializer):
    """Create bubble with `expires_in_seconds` instead of raw `expires_at`."""

    expires_in_seconds = serializers.IntegerField(min_value=60, max_value=86400)

    class Meta:
        model = Bubble
        fields = ("title", "latitude", "longitude", "radius", "expires_in_seconds")

    def validate_radius(self, value: int) -> int:
        if value < 50 or value > 100_000:
            raise serializers.ValidationError("Radius must be between 50 and 100000 meters.")
        return value

    def validate_latitude(self, value: float) -> float:
        if value < -90 or value > 90:
            raise serializers.ValidationError("Latitude out of range.")
        return value

    def validate_longitude(self, value: float) -> float:
        if value < -180 or value > 180:
            raise serializers.ValidationError("Longitude out of range.")
        return value

    def create(self, validated_data: dict) -> Bubble:
        seconds = int(validated_data.pop("expires_in_seconds"))
        validated_data["expires_at"] = timezone.now() + timedelta(seconds=seconds)
        validated_data.setdefault("active", True)
        return Bubble.objects.create(**validated_data)


class MessageCreateSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000, allow_blank=False, trim_whitespace=True)
    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)


class MessageOutSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ("id", "anonymous_name", "message", "created_at")
