import uuid

from django.db import models


class AnonymousSession(models.Model):
    """
    Long-lived anonymous identity for a browser.
    `session_uuid` is stored in an HttpOnly cookie; `anonymous_name` is shown in chat.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    anonymous_name = models.CharField(max_length=64)
    session_uuid = models.UUIDField(unique=True, db_index=True, default=uuid.uuid4)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.anonymous_name} ({self.session_uuid})"
