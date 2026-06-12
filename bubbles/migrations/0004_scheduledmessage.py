import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("bubbles", "0003_message_image"),
    ]

    operations = [
        migrations.CreateModel(
            name="ScheduledMessage",
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
                (
                    "batch_id",
                    models.UUIDField(db_index=True),
                ),
                ("anonymous_name", models.CharField(max_length=64)),
                ("message", models.TextField()),
                ("release_at", models.DateTimeField(db_index=True)),
                ("released_at", models.DateTimeField(blank=True, null=True)),
                ("is_ai_generated", models.BooleanField(default=True)),
                ("order_in_batch", models.PositiveSmallIntegerField(default=0)),
                (
                    "bubble",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="scheduled_messages",
                        to="bubbles.bubble",
                    ),
                ),
            ],
            options={
                "ordering": ["release_at", "order_in_batch"],
            },
        ),
        migrations.RunSQL(
            sql="""
                CREATE INDEX IF NOT EXISTS bubbles_sch_bub_rel_idx
                ON bubbles_scheduledmessage (bubble_id, released_at, release_at);
            """,
            reverse_sql="DROP INDEX IF EXISTS bubbles_sch_bub_rel_idx;",
            state_operations=[
                migrations.AddIndex(
                    model_name="scheduledmessage",
                    index=models.Index(
                        fields=["bubble", "released_at", "release_at"],
                        name="bubbles_sch_bub_rel_idx",
                    ),
                ),
            ],
        ),
    ]
