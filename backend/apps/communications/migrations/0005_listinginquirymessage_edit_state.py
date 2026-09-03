from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("communications", "0004_listing_inquiry_opening_snapshot")]

    operations = [
        migrations.AddField(
            model_name="listinginquirymessage",
            name="edit_locked_at",
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name="listinginquirymessage",
            name="edited_at",
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
    ]
