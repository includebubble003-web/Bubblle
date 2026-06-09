from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bubbles", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="message",
            name="image",
            field=models.ImageField(blank=True, null=True, upload_to="chat/%Y/%m/%d/"),
        ),
        migrations.AddField(
            model_name="message",
            name="image_height",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="message",
            name="image_width",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="message",
            name="message",
            field=models.TextField(blank=True, default=""),
        ),
    ]
