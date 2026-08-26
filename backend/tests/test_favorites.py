from datetime import timedelta
from typing import Any

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import Favorite, Listing, ListingState, Property
from apps.catalog.services import merge_properties


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


@pytest.mark.django_db
def test_favorites_collection_separates_active_and_unavailable_without_stale_listing_facts(
    api_client: APIClient, user: User, active_property: Property
) -> None:
    favorites = Favorite.objects.create(account=user, property=active_property)
    Listing.objects.filter(property=active_property).update(
        available_until=timezone.now() - timedelta(seconds=1)
    )
    api_client.force_authenticate(user=user)

    response = api_client.get("/api/v1/catalog/favorites/")

    assert response.status_code == 200
    assert response.data["active"] == []
    assert response.data["unavailable"] == [
        {
            "id": str(active_property.id),
            "title": active_property.title,
            "location": {
                "city": active_property.city.name_fa,
                "district": active_property.district.name_fa,
                "district_number": active_property.district.number,
                "neighborhood": active_property.neighborhood.name_fa,
            },
            "property_category": active_property.property_category,
            "property_category_label": active_property.property_category_label,
            "property_type": active_property.property_type,
            "property_type_label": active_property.get_property_type_display(),
            "area_sqm": active_property.area_sqm,
            **(
                {"room_count": active_property.room_count}
                if active_property.room_count is not None
                else {}
            ),
            "saved_at": favorites.saved_at.isoformat().replace("+00:00", "Z"),
        }
    ]


@pytest.mark.django_db
def test_favorites_collection_orders_active_newest_saved_first_and_reactivates_relisted_property(
    api_client: APIClient, user: User, active_property: Property
) -> None:
    other_property = (
        Property.objects
        .filter(listings__state=ListingState.PUBLISHED)
        .exclude(pk=active_property.pk)
        .distinct()
        .first()
    )
    assert other_property is not None
    older = Favorite.objects.create(account=user, property=active_property)
    newer = Favorite.objects.create(account=user, property=other_property)
    Favorite.objects.filter(pk=older.pk).update(saved_at=timezone.now() - timedelta(days=1))
    Favorite.objects.filter(pk=newer.pk).update(saved_at=timezone.now())
    Listing.objects.filter(property=active_property).update(
        available_until=timezone.now() - timedelta(seconds=1)
    )
    api_client.force_authenticate(user=user)

    unavailable = api_client.get("/api/v1/catalog/favorites/")
    assert [item["id"] for item in unavailable.data["active"]] == [str(other_property.id)]
    assert [item["id"] for item in unavailable.data["unavailable"]] == [str(active_property.id)]

    listing = Listing.objects.filter(property=active_property).first()
    assert listing is not None
    listing.available_until = timezone.now() + timedelta(days=1)
    listing.save(update_fields=["available_until", "updated_at"])

    relisted = api_client.get("/api/v1/catalog/favorites/")
    assert [item["id"] for item in relisted.data["active"]] == [
        str(other_property.id),
        str(active_property.id),
    ]
    assert relisted.data["unavailable"] == []
    assert "rental_terms" in relisted.data["active"][1]


@pytest.mark.django_db
def test_renter_removes_an_unavailable_favorite(
    api_client: APIClient, user: User, active_property: Property
) -> None:
    Favorite.objects.create(account=user, property=active_property)
    Listing.objects.filter(property=active_property).update(
        available_until=timezone.now() - timedelta(seconds=1)
    )
    api_client.force_authenticate(user=user)

    response = api_client.delete(f"/api/v1/catalog/properties/{active_property.id}/favorite/")

    assert response.status_code == 204
    assert not Favorite.objects.filter(account=user, property=active_property).exists()


@pytest.mark.django_db
def test_property_merge_transfers_favorites_without_duplicates(
    api_client: APIClient, user: User, active_property: Property
) -> None:
    duplicate = (
        Property.objects
        .filter(listings__state=ListingState.PUBLISHED)
        .exclude(pk=active_property.pk)
        .distinct()
        .first()
    )
    assert duplicate is not None
    other_user = User.objects.create_user(
        email="merge-renter@example.com", password="correct-horse-battery"
    )
    Favorite.objects.create(account=user, property=active_property)
    Favorite.objects.create(account=user, property=duplicate)
    Favorite.objects.create(account=other_user, property=duplicate)

    merge_properties(target=active_property, duplicate=duplicate)

    assert list(Favorite.objects.filter(account=user).values_list("property_id", flat=True)) == [
        active_property.id
    ]
    assert Favorite.objects.filter(account=other_user, property=active_property).exists()

    api_client.force_authenticate(user=user)
    collection = api_client.get("/api/v1/catalog/favorites/")
    assert [item["id"] for item in collection.data["active"]] == [str(active_property.id)]
    assert collection.data["unavailable"] == []


@pytest.mark.django_db
def test_permanently_deleting_property_removes_its_favorite_and_leaves_no_api_snapshot(
    api_client: APIClient, user: User, active_property: Property
) -> None:
    Favorite.objects.create(account=user, property=active_property)
    Listing.objects.filter(property=active_property).delete()
    active_property.delete()
    api_client.force_authenticate(user=user)

    response = api_client.get("/api/v1/catalog/favorites/")

    assert Favorite.objects.filter(account=user).count() == 0
    assert response.data == {"active": [], "unavailable": []}
