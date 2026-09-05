import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0014_reference_common_media_asset"),
        ("common", "0001_move_media_asset_state"),
        ("submissions", "0013_preserve_history_after_submitter_deletion"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AlterField(
                    model_name="submissionimagevariant",
                    name="asset",
                    field=models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="submission_variants",
                        to="common.mediaasset",
                    ),
                ),
                migrations.DeleteModel(name="MediaAsset"),
            ],
        ),
    ]
