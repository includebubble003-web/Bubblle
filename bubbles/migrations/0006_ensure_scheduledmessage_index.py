"""Ensure ScheduledMessage composite index exists (safe for partial/failed 0004 applies)."""
from django.db import migrations


def ensure_index(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT 1 FROM information_schema.tables
            WHERE table_name = 'bubbles_scheduledmessage'
            """
        )
        if not cursor.fetchone():
            return
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS bubbles_sch_bub_rel_idx
            ON bubbles_scheduledmessage (bubble_id, released_at, release_at)
            """
        )


class Migration(migrations.Migration):
    dependencies = [
        ("bubbles", "0005_persistent_bubbles"),
    ]

    operations = [
        migrations.RunPython(ensure_index, migrations.RunPython.noop),
    ]
