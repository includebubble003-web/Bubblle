import uuid

from django.db import models


class Bubble(models.Model):
    """
    A geo-fenced community centered at (latitude, longitude).
    `radius` is meters — users must be within this distance to join/chat.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=120)
    latitude = models.FloatField()
    longitude = models.FloatField()
    radius = models.PositiveIntegerField(help_text="Geofence radius in meters.")
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True, null=True, blank=True)
    active = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["active", "expires_at"]),
        ]

    def __str__(self) -> str:
        return self.title

    def is_joinable(self) -> bool:
        return self.active


class Message(models.Model):
    """Persisted chat line inside a bubble."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bubble = models.ForeignKey(Bubble, on_delete=models.CASCADE, related_name="messages")
    anonymous_name = models.CharField(max_length=64)
    message = models.TextField(blank=True, default="")
    image = models.ImageField(upload_to="chat/%Y/%m/%d/", blank=True, null=True)
    image_width = models.PositiveIntegerField(null=True, blank=True)
    image_height = models.PositiveIntegerField(null=True, blank=True)
    reply_to = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="replies",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["bubble", "created_at"]),
        ]


class ScheduledMessage(models.Model):
    """AI/demo lines queued for gradual release — avoids realtime LLM spam."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bubble = models.ForeignKey(
        Bubble, on_delete=models.CASCADE, related_name="scheduled_messages"
    )
    batch_id = models.UUIDField(db_index=True)
    anonymous_name = models.CharField(max_length=64)
    message = models.TextField()
    release_at = models.DateTimeField(db_index=True)
    released_at = models.DateTimeField(null=True, blank=True)
    is_ai_generated = models.BooleanField(default=True)
    order_in_batch = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["release_at", "order_in_batch"]
        indexes = [
            models.Index(fields=["bubble", "released_at", "release_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.anonymous_name}: {self.message[:40]}"
