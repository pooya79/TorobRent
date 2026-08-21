from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import Listing, ListingState


@transaction.atomic
def publish_listing(listing: Listing) -> Listing:
    listing.property.full_clean()
    listing.terms.full_clean()
    listing.full_clean()
    now = timezone.now()
    listing.property.normalized_at = now
    listing.property.save(update_fields=["normalized_at"])
    if listing.published_at is None:
        listing.published_at = now
    listing.availability_confirmed_at = now
    listing.available_until = now + timedelta(days=30)
    listing.state = ListingState.PUBLISHED
    listing.save()
    return listing
