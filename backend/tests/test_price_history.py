from datetime import timedelta

import pytest
from django.core.management import call_command
from django.db import transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.catalog.models import Listing, ListingState


@pytest.mark.django_db
def test_price_history_records_only_changed_published_pairs_and_serializes_toman():
    call_command("seed_dev", verbosity=0)
    listing = Listing.objects.filter(state=ListingState.PUBLISHED).select_related("terms").first()
    assert listing is not None
    listing.available_until = timezone.now() + timedelta(days=30)
    listing.save()
    assert listing.price_history.count() == 1
    original = listing.price_history.get()
    listing.save()
    listing.terms.is_negotiable = True
    listing.terms.save()
    assert listing.price_history.count() == 1

    listing.terms.deposit_rial += 100_000_000
    listing.terms.monthly_rent_rial += 10_000_000
    listing.terms.save()
    assert listing.price_history.count() == 2
    response = APIClient().get(f"/api/v1/catalog/properties/{listing.property_id}/")
    assert response.status_code == 200
    result = next(row for row in response.data["listings"] if row["id"] == str(listing.pk))
    assert result["price_history"][0]["deposit_toman"] == original.deposit_rial // 10
    assert result["price_history"][1]["deposit_toman"] == listing.terms.deposit_rial // 10
    assert result["price_history"][1]["monthly_rent_toman"] == listing.terms.monthly_rent_rial // 10

    listing.state = ListingState.DRAFT
    listing.save()
    listing.terms.deposit_rial += 100_000_000
    listing.terms.save()
    assert listing.price_history.count() == 2
    listing.state = ListingState.PUBLISHED
    listing.save()
    assert listing.price_history.count() == 3


@pytest.mark.django_db
def test_price_history_rolls_back_with_price_update():
    call_command("seed_dev", verbosity=0)
    listing = Listing.objects.filter(state=ListingState.PUBLISHED).select_related("terms").first()
    assert listing is not None
    listing.save()
    with pytest.raises(ValueError), transaction.atomic():
        listing.terms.deposit_rial += 100_000_000
        listing.terms.save()
        raise ValueError("abort update")
    assert listing.price_history.count() == 1
