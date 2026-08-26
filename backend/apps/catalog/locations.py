import hashlib
import hmac
import math
from decimal import Decimal

from django.conf import settings

from .models import LocationPrecision, Property

APPROXIMATE_RADIUS_METERS = 500
NEIGHBORHOOD_RADIUS_METERS = 1500
EARTH_RADIUS_METERS = 6_371_000


def derive_public_location(property_: Property) -> None:
    """Populate the persisted public location without exposing the restricted source point."""
    if property_.latitude is not None and property_.longitude is not None:
        digest = hmac.new(
            settings.SECRET_KEY.encode(),
            property_.id.bytes,
            hashlib.sha256,
        ).digest()
        angle = int.from_bytes(digest[:8], "big") / (2**64) * math.tau
        distance = 180 + int.from_bytes(digest[8:16], "big") / (2**64) * 140
        latitude = float(property_.latitude)
        longitude = float(property_.longitude)
        latitude_offset = math.cos(angle) * distance / EARTH_RADIUS_METERS
        longitude_offset = (
            math.sin(angle) * distance / (EARTH_RADIUS_METERS * math.cos(math.radians(latitude)))
        )
        property_.approximate_latitude = Decimal(f"{latitude + math.degrees(latitude_offset):.6f}")
        property_.approximate_longitude = Decimal(
            f"{longitude + math.degrees(longitude_offset):.6f}"
        )
        property_.location_precision = LocationPrecision.APPROXIMATE
        property_.location_radius_meters = APPROXIMATE_RADIUS_METERS
        return

    neighborhood = property_.neighborhood
    if (
        neighborhood is not None
        and neighborhood.center_latitude is not None
        and neighborhood.center_longitude is not None
    ):
        property_.approximate_latitude = neighborhood.center_latitude
        property_.approximate_longitude = neighborhood.center_longitude
        property_.location_precision = LocationPrecision.NEIGHBORHOOD
        property_.location_radius_meters = NEIGHBORHOOD_RADIUS_METERS
        return

    property_.approximate_latitude = None
    property_.approximate_longitude = None
    property_.location_precision = ""
    property_.location_radius_meters = None
