import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("submissions", "0013_preserve_history_after_submitter_deletion"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.CreateModel(
                    name="MediaAsset",
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
                        ("file", models.FileField(max_length=500, unique=True, upload_to="")),
                        ("width", models.PositiveIntegerField()),
                        ("height", models.PositiveIntegerField()),
                        ("byte_size", models.PositiveIntegerField()),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                    ],
                    options={"db_table": "submissions_mediaasset"},
                ),
            ],
        ),
    ]
