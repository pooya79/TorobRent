import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0013_reduce_approximate_location_radius"),
        ("common", "0001_move_media_asset_state"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AlterField(
                    model_name="listingimagevariant",
                    name="asset",
                    field=models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="listing_variants",
                        to="common.mediaasset",
                    ),
                ),
                migrations.AlterField(
                    model_name="propertyimagevariant",
                    name="asset",
                    field=models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="property_variants",
                        to="common.mediaasset",
                    ),
                ),
            ],
        ),
    ]
