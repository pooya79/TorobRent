from copy import deepcopy

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.catalog.match_suggestions import evaluate_property_pair
from apps.catalog.models import (
    Favorite,
    Listing,
    ListingState,
    OutboundPolicy,
    Property,
    PropertyImage,
    PropertyImageVariant,
    PropertyMatchSuggestion,
    Source,
)
from apps.catalog.services import merge_properties
from tests.test_catalog_curation import attach_listing_image, image_fixture
from tests.test_grouped_property_consistency import make_operator, make_property

BASE = "/api/v1/operator/catalog-curation/grouped-properties/"


@pytest.fixture
def source() -> Source:
    return Source.objects.create(
        name="partition-source",
        domain="partition.example",
        display_name="منبع تفکیک",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )


@pytest.fixture
def partition_case(api_client: APIClient, source):
    survivor, survivor_listing = make_property(source, "SURVIVOR")
    historical, historical_listing = make_property(source, "HISTORICAL", area_sqm=120)
    _, third_listing = make_property(source, "THIRD")
    merge_properties(target=survivor, duplicate=historical, reason="گروه‌بندی پیشین")
    third_listing.property = survivor
    third_listing.state = ListingState.ARCHIVED
    third_listing.save(update_fields=["property", "state"])
    operator = make_operator()
    api_client.force_authenticate(operator)
    return operator, survivor, survivor_listing, historical, historical_listing, third_listing


def preview(client: APIClient, property_: Property, listing_ids: list[str]):
    return client.post(
        f"{BASE}{property_.pk}/partitions/preview/",
        {"listing_ids": listing_ids},
        format="json",
    )


def claim(client: APIClient, property_: Property, opened):
    return client.post(
        f"{BASE}{property_.pk}/partitions/claim/",
        {"listing_ids": opened.data["selected_listing_ids"], "revision": opened.data["revision"]},
        format="json",
    )


@pytest.mark.django_db
def test_partition_restores_historical_property_and_preserves_listing_bound_data(
    api_client: APIClient, partition_case
):
    operator, survivor, survivor_listing, historical, moved, remaining = partition_case
    Favorite.objects.create(account=operator, property=survivor)
    listing_image = attach_listing_image(moved, image_fixture(), position=0)
    listing_variant = listing_image.variants.get()
    property_image = PropertyImage.objects.create(
        property=survivor,
        position=0,
        is_primary=True,
        reviewed_at=timezone.now(),
        reviewed_by=operator,
    )
    PropertyImageVariant.objects.create(
        image=property_image,
        kind=listing_variant.kind,
        asset=listing_variant.asset,
    )
    original = {
        "terms_id": moved.terms_id,
        "source_claims": deepcopy(moved.source_claims),
        "state": moved.state,
        "external_url": moved.external_url,
    }

    opened = preview(api_client, survivor, [str(moved.pk)])

    assert opened.status_code == 200, opened.data
    assert opened.data["selected_listing_ids"] == [str(moved.pk)]
    assert {item["id"] for item in opened.data["remaining_listings"]} == {
        str(item.pk) for item in (remaining, survivor_listing)
    }
    assert opened.data["restoration_options"][0]["id"] == str(historical.pk)
    assert opened.data["favorites"]["surviving_count"] == 1
    assert opened.data["property_images"] == [
        {
            "id": str(property_image.pk),
            "property_id": str(survivor.pk),
            "url": f"/api/v1/operator/catalog-curation/images/{property_image.pk}/",
        }
    ]
    assert "grouping_history" in opened.data
    assert "normalized_facts" in opened.data["resulting_properties"][0]

    claimed = claim(api_client, survivor, opened)
    assert claimed.status_code == 200, claimed.data
    confirmed = api_client.post(
        f"{BASE}{survivor.pk}/partitions/confirm/",
        {
            "listing_ids": [str(moved.pk)],
            "revision": opened.data["revision"],
            "claim_id": claimed.data["claim"]["id"],
            "destination_mode": "restore",
            "destination_property_id": str(historical.pk),
            "normalized_facts": {},
            "image_ids": [str(property_image.pk)],
            "facts_confirmed": True,
            "images_confirmed": True,
            "reason": "آگهی به واحد دیگری مربوط است",
        },
        format="json",
    )

    assert confirmed.status_code == 201, confirmed.data
    moved.refresh_from_db()
    historical.refresh_from_db()
    assert moved.property_id == historical.pk
    assert historical.merged_into_id is None
    assert {field: getattr(moved, field) for field in original} == original
    assert Favorite.objects.filter(property=survivor).count() == 1
    assert Favorite.objects.filter(property=historical).count() == 0
    assert survivor.images.filter(retired_at__isnull=True).count() == 1
    copied_image = historical.images.get(retired_at__isnull=True)
    assert copied_image.variants.get().asset_id == listing_variant.asset_id
    surviving_public = api_client.get(f"/api/v1/catalog/properties/{survivor.pk}/")
    restored_public = api_client.get(f"/api/v1/catalog/properties/{historical.pk}/")
    assert surviving_public.status_code == restored_public.status_code == 200
    assert surviving_public.data["id"] == str(survivor.pk)
    assert restored_public.data["id"] == str(historical.pk)
    assert len(surviving_public.data["listings"]) == 1
    assert confirmed.data["before_revision"] == opened.data["revision"]
    assert confirmed.data["after_revision"] != opened.data["revision"]
    assert confirmed.data["selected_listing_ids"] == [str(moved.pk)]
    assert len(confirmed.data["grouping_event_ids"]) == 1
    audit = api_client.get(
        f"/api/v1/operator/catalog-curation/partition-decisions/{confirmed.data['id']}/"
    )
    assert audit.status_code == 200
    assert audit.data["evidence"]["favorites"][0]["property_id"] == str(survivor.pk)
    assert audit.data["evidence"]["property_image_variants"][0]["asset_id"] == str(
        listing_variant.asset_id
    )
    assert audit.data["after_snapshot"]["separated"]["property_images"][0]["property_id"] == str(
        historical.pk
    )
    assert {
        item["asset_id"]
        for item in audit.data["after_snapshot"]["separated"]["property_image_variants"]
    } == {str(listing_variant.asset_id)}
    suppression = PropertyMatchSuggestion.objects.get(
        left_id=min(survivor.pk, historical.pk), right_id=max(survivor.pk, historical.pk)
    )
    assert suppression.state == "rejected"
    assert suppression.suppressed_evidence_fingerprint == suppression.evidence_fingerprint


@pytest.mark.django_db
def test_partition_creates_confirmed_property_for_subgroup_and_rejects_stale_review(
    api_client: APIClient, partition_case
):
    _, survivor, _, _, historical_listing, third_listing = partition_case
    third_listing_bound = {
        "terms_id": third_listing.terms_id,
        "source_claims": deepcopy(third_listing.source_claims),
        "state": third_listing.state,
        "available_until": third_listing.available_until,
        "external_url": third_listing.external_url,
    }
    selected = [str(historical_listing.pk), str(third_listing.pk)]
    opened = preview(api_client, survivor, selected)
    assert opened.status_code == 200, opened.data
    claimed = claim(api_client, survivor, opened)
    survivor.area_sqm = 91
    survivor.save(update_fields=["area_sqm"])

    payload = {
        "listing_ids": selected,
        "revision": opened.data["revision"],
        "claim_id": claimed.data["claim"]["id"],
        "destination_mode": "new",
        "normalized_facts": opened.data["new_property_defaults"],
        "image_ids": [],
        "facts_confirmed": True,
        "images_confirmed": True,
    }
    assert (
        api_client.post(
            f"{BASE}{survivor.pk}/partitions/confirm/", payload, format="json"
        ).status_code
        == 409
    )
    refreshed = preview(api_client, survivor, selected)
    renewed = claim(api_client, survivor, refreshed)
    payload["revision"] = refreshed.data["revision"]
    payload["claim_id"] = renewed.data["claim"]["id"]
    payload["normalized_facts"] = refreshed.data["new_property_defaults"]
    result = api_client.post(f"{BASE}{survivor.pk}/partitions/confirm/", payload, format="json")
    assert result.status_code == 201, result.data
    assert Listing.objects.filter(pk__in=selected).values("property_id").distinct().count() == 1
    assert Listing.objects.filter(property=survivor).count() == 1
    destination = Property.objects.get(pk=result.data["separated_property_id"])
    third_listing.refresh_from_db()
    assert {
        field: getattr(third_listing, field) for field in third_listing_bound
    } == third_listing_bound
    repeated = evaluate_property_pair(survivor.pk, destination.pk, origin="focused")
    assert repeated is not None
    assert repeated.state == "rejected"
    historical_listing.source_claims = {"address": "شواهد هویتی تازه"}
    historical_listing.save(update_fields=["source_claims"])
    changed = evaluate_property_pair(survivor.pk, destination.pk, origin="focused")
    assert changed is not None
    assert changed.state == "pending"


@pytest.mark.django_db
@pytest.mark.parametrize("selected", [[], ["all"]])
def test_partition_requires_a_non_empty_proper_subset(
    api_client: APIClient, partition_case, selected
):
    _, survivor, *_ = partition_case
    listing_ids = (
        [str(item.pk) for item in survivor.listings.all()] if selected == ["all"] else selected
    )
    assert preview(api_client, survivor, listing_ids).status_code == 400


@pytest.mark.django_db
def test_operator_cannot_partition_their_own_direct_listing(api_client: APIClient, partition_case):
    from apps.submissions.models import Submission

    operator, survivor, _, _, listing, _ = partition_case
    listing.source.outbound_policy = OutboundPolicy.DIRECT_CONTACT
    listing.source.save(update_fields=["outbound_policy"])
    Submission.objects.create(submitter=operator, role="owner", listing=listing)

    response = preview(api_client, survivor, [str(listing.pk)])

    assert response.status_code == 403


def postgres_only() -> None:
    from django.db import connection

    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL row-lock contract")


@pytest.mark.django_db(transaction=True)
def test_competing_partition_claims_have_one_winner(api_client: APIClient, partition_case):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections

    _, survivor, _, _, selected, _ = partition_case
    postgres_only()
    opened = preview(api_client, survivor, [str(selected.pk)])
    actors = [make_operator() for _ in range(2)]
    barrier = Barrier(2)

    def submit(index: int) -> int:
        close_old_connections()
        client = APIClient()
        client.force_authenticate(actors[index])
        try:
            barrier.wait(timeout=10)
            return client.post(
                f"{BASE}{survivor.pk}/partitions/claim/",
                {
                    "listing_ids": [str(selected.pk)],
                    "revision": opened.data["revision"],
                },
                format="json",
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, range(2)))
    assert sorted(results) == [200, 409]


@pytest.mark.django_db(transaction=True)
def test_storage_failure_rolls_back_entire_partition(api_client: APIClient, partition_case):
    from django.db import ProgrammingError, connection

    _, survivor, _, _, selected, _ = partition_case
    postgres_only()
    opened = preview(api_client, survivor, [str(selected.pk)])
    claimed = claim(api_client, survivor, opened)
    property_count = Property.objects.count()
    payload = {
        "listing_ids": [str(selected.pk)],
        "revision": opened.data["revision"],
        "claim_id": claimed.data["claim"]["id"],
        "destination_mode": "new",
        "normalized_facts": opened.data["new_property_defaults"],
        "image_ids": [],
        "facts_confirmed": True,
        "images_confirmed": True,
    }
    with connection.cursor() as cursor:
        cursor.execute(
            "CREATE FUNCTION pg_temp.reject_partition() RETURNS trigger LANGUAGE plpgsql AS $$ "
            "BEGIN RAISE EXCEPTION 'test partition failure'; END $$"
        )
        cursor.execute(
            "CREATE TRIGGER test_reject_partition BEFORE INSERT ON catalog_listinggroupingevent "
            "FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_partition()"
        )
    try:
        with pytest.raises(ProgrammingError, match="test partition failure"):
            api_client.post(f"{BASE}{survivor.pk}/partitions/confirm/", payload, format="json")
    finally:
        with connection.cursor() as cursor:
            cursor.execute("DROP TRIGGER test_reject_partition ON catalog_listinggroupingevent")
    selected.refresh_from_db()
    assert selected.property_id == survivor.pk
    assert Property.objects.count() == property_count
