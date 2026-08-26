from datetime import timedelta
from typing import Any

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import Favorite, Listing, ListingState, Property


@pytest.fixture
def active_property(db: Any) -> Property:
    call_command("seed_demo", verbosity=0)
    property_ = Property.objects.filter(listings__state=ListingState.PUBLISHED).first()
    assert property_ is not None
    return property_


@pytest.mark.django_db
def test_favorite_uniquely_records_when_an_account_saved_a_property(
    user: User, active_property: Property
) -> None:
    before_save = timezone.now()

    favorite, created = Favorite.objects.get_or_create(account=user, property=active_property)
    duplicate, duplicate_created = Favorite.objects.get_or_create(
        account=user, property=active_property
    )

    assert created is True
    assert duplicate_created is False
    assert duplicate.pk == favorite.pk
    assert favorite.saved_at >= before_save


@pytest.mark.django_db
def test_anonymous_renter_cannot_change_favorites_and_search_omits_favorite_state(
    api_client: APIClient, active_property: Property
) -> None:
    endpoint = f"/api/v1/catalog/properties/{active_property.id}/favorite/"

    assert api_client.put(endpoint).status_code == 401
    assert api_client.delete(endpoint).status_code == 401
    assert Favorite.objects.count() == 0

    search = api_client.get("/api/v1/catalog/properties/")
    assert search.status_code == 200
    assert all("is_favorite" not in result for result in search.data["results"])


@pytest.mark.django_db
def test_authenticated_renter_saves_and_removes_an_active_property_idempotently(
    api_client: APIClient, user: User, active_property: Property
) -> None:
    api_client.force_authenticate(user=user)
    endpoint = f"/api/v1/catalog/properties/{active_property.id}/favorite/"

    assert api_client.put(endpoint).status_code == 204
    assert api_client.put(endpoint).status_code == 204
    assert Favorite.objects.filter(account=user, property=active_property).count() == 1
    saved_search = api_client.get("/api/v1/catalog/properties/")
    saved_summary = next(
        result for result in saved_search.data["results"] if result["id"] == str(active_property.id)
    )
    assert saved_summary["is_favorite"] is True

    assert api_client.delete(endpoint).status_code == 204
    assert api_client.delete(endpoint).status_code == 204
    assert not Favorite.objects.filter(account=user, property=active_property).exists()
    removed_search = api_client.get("/api/v1/catalog/properties/")
    removed_summary = next(
        result
        for result in removed_search.data["results"]
        if result["id"] == str(active_property.id)
    )
    assert removed_summary["is_favorite"] is False


@pytest.mark.django_db
def test_favorite_state_is_scoped_to_the_current_account(
    api_client: APIClient, user: User, active_property: Property
) -> None:
    Favorite.objects.create(account=user, property=active_property)
    other_user = User.objects.create_user(
        email="other-renter@example.com", password="correct-horse-battery"
    )
    api_client.force_authenticate(user=other_user)

    search = api_client.get("/api/v1/catalog/properties/")
    summary = next(
        result for result in search.data["results"] if result["id"] == str(active_property.id)
    )

    assert summary["is_favorite"] is False


@pytest.mark.django_db
def test_renter_cannot_save_a_property_without_an_active_listing(
    api_client: APIClient, user: User, active_property: Property
) -> None:
    Listing.objects.filter(property=active_property).update(
        available_until=timezone.now() - timedelta(seconds=1)
    )
    api_client.force_authenticate(user=user)

    response = api_client.put(f"/api/v1/catalog/properties/{active_property.id}/favorite/")

    assert response.status_code == 404
    assert not Favorite.objects.filter(account=user, property=active_property).exists()
