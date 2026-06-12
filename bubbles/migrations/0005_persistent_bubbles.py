"""Make bubbles persistent: nullable expires_at, reactivate existing bubbles."""
from django.db import migrations, models


def reactivate_bubbles(apps, schema_editor):
    Bubble = apps.get_model("bubbles", "Bubble")
    Bubble.objects.all().update(active=True, expires_at=None)


class Migration(migrations.Migration):
    dependencies = [
        ("bubbles", "0004_scheduledmessage"),
    ]

    operations = [
        migrations.AlterField(
            model_name="bubble",
            name="expires_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.RunPython(reactivate_bubbles, migrations.RunPython.noop),
    ]
