import hashlib
import hmac
import math
from decimal import Decimal

from django.conf import settings
from django.db import migrations


def reduce_existing_approximation_radius(apps, _schema_editor):
    property_model = apps.get_model("catalog", "Property")
    for property_ in property_model.objects.filter(
        latitude__isnull=False,
        longitude__isnull=False,
        location_precision="approximate",
    ).iterator():
        digest = hmac.new(settings.SECRET_KEY.encode(), property_.id.bytes, hashlib.sha256).digest()
        angle = int.from_bytes(digest[:8], "big") / (2**64) * math.tau
        distance = 18 + int.from_bytes(digest[8:16], "big") / (2**64) * 14
        latitude = float(property_.latitude)
        longitude = float(property_.longitude)
        latitude_offset = math.cos(angle) * distance / 6_371_000
        longitude_offset = (
            math.sin(angle) * distance / (6_371_000 * math.cos(math.radians(latitude)))
        )
        property_.approximate_latitude = Decimal(f"{latitude + math.degrees(latitude_offset):.6f}")
        property_.approximate_longitude = Decimal(
            f"{longitude + math.degrees(longitude_offset):.6f}"
        )
        property_.location_radius_meters = 50
        property_.save(
            update_fields=(
                "approximate_latitude",
                "approximate_longitude",
                "location_radius_meters",
            )
        )


class Migration(migrations.Migration):
    dependencies = [("catalog", "0012_propertyimage_propertyimagevariant")]

    operations = [
        migrations.RunPython(
            reduce_existing_approximation_radius,
            migrations.RunPython.noop,
        )
    ]
