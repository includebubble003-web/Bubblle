from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bubbles", "0008_system_seed_content"),
    ]

    operations = [
        migrations.AddField(
            model_name="message",
            name="pdf",
            field=models.FileField(blank=True, null=True, upload_to="chat/%Y/%m/%d/"),
        ),
        migrations.AddField(
            model_name="message",
            name="pdf_name",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="message",
            name="pdf_size",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
