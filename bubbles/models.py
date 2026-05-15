import uuid

from django.db import models
from django.utils import timezone


class Bubble(models.Model):
    """
    A temporary geo-fenced chat room centered at (latitude, longitude).
    `radius` is meters — users must be within this distance to join/chat.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=120)
    latitude = models.FloatField()
    longitude = models.FloatField()
    radius = models.PositiveIntegerField(help_text="Geofence radius in meters.")
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)
    active = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["active", "expires_at"]),
        ]

    def __str__(self) -> str:
        return self.title

    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    def is_joinable(self) -> bool:
        return self.active and not self.is_expired()


class Message(models.Model):
    """Persisted chat line inside a bubble."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bubble = models.ForeignKey(Bubble, on_delete=models.CASCADE, related_name="messages")
    anonymous_name = models.CharField(max_length=64)
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["bubble", "created_at"]),
        ]
