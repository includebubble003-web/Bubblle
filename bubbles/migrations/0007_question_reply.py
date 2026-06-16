import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bubbles", "0006_ensure_scheduledmessage_index"),
    ]

    operations = [
        migrations.CreateModel(
            name="Question",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("title", models.CharField(max_length=200)),
                ("description", models.TextField(blank=True, default="")),
                ("anonymous_name", models.CharField(max_length=64)),
                ("latitude", models.FloatField()),
                ("longitude", models.FloatField()),
                ("active", models.BooleanField(db_index=True, default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("last_activity_at", models.DateTimeField(auto_now_add=True)),
                (
                    "bubble",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="questions",
                        to="bubbles.bubble",
                    ),
                ),
            ],
            options={
                "ordering": ["-last_activity_at"],
            },
        ),
        migrations.CreateModel(
            name="Reply",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("anonymous_name", models.CharField(max_length=64)),
                ("message", models.TextField(max_length=2000)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "question",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="replies",
                        to="bubbles.question",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="question",
            index=models.Index(
                fields=["active", "last_activity_at"],
                name="bubbles_q_active_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="question",
            index=models.Index(
                fields=["bubble", "last_activity_at"],
                name="bubbles_q_bubble_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="reply",
            index=models.Index(
                fields=["question", "created_at"],
                name="bubbles_reply_q_idx",
            ),
        ),
    ]
