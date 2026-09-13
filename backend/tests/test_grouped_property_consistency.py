from decimal import Decimal

import pytest
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.group_consistency import measure_group_consistency
from apps.catalog.match_suggestions import evaluate_property_pair
from apps.catalog.matching import SCORING_VERSION
from apps.catalog.models import (
    Listing,
    ListingGroupingAction,
    ListingGroupingEvent,
    ListingImage,
    ListingState,
    OutboundPolicy,
    Property,
    PropertyGroupConsistencyMeasurement,
    PropertyType,
    RentalTerms,
    Source,
)
from apps.catalog.services import merge_properties, split_listing
from apps.catalog.tasks import (
    GROUP_CONSISTENCY_RECONCILIATION_LOCK,
    reconcile_grouped_property_consistency,
)


def make_operator(*, can_curate: bool = True) -> User:
    operator = User.objects.create_user(
        email=f"group-curator-{User.objects.count()}@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    if can_curate:
        operator.user_permissions.add(Permission.objects.get(codename="curate_catalog"))
    return operator


def make_property(
    source: Source, reference: str, *, area_sqm: int = 90
) -> tuple[Property, Listing]:
    from apps.catalog.models import Neighborhood

    if not Neighborhood.objects.exists():
        call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    property_ = Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=area_sqm,
        room_count=2,
        floor=3,
        total_floors=6,
        units_per_floor=2,
        parking="present",
        elevator="present",
        latitude=Decimal("35.774100"),
        longitude=Decimal("51.356200"),
    )
    listing = Listing.objects.create(
        property=property_,
        source=source,
        terms=RentalTerms.objects.create(
            deposit_rial=5_000_000_000,
            monthly_rent_rial=300_000_000,
        ),
        state=ListingState.PUBLISHED,
        source_reference=reference,
        external_url=f"https://{source.domain}/{reference}",
        available_until=timezone.now() + timezone.timedelta(days=14),
    )
    return property_, listing


def approve_suggestion(api_client: APIClient, suggestion_id: str, *, survivor_id: str) -> None:
    detail = api_client.get(f"/api/v1/operator/catalog-curation/suggestions/{suggestion_id}/").data
    comparison = detail["comparison"]
    claim = api_client.post(
        "/api/v1/operator/catalog-curation/claim/",
        {
            "properties": detail["property_ids"],
            "revision": comparison["revision"],
            "suggestion_id": suggestion_id,
        },
        format="json",
    ).data["claim"]
    response = api_client.post(
        "/api/v1/operator/catalog-curation/approve/",
        {
            "properties": detail["property_ids"],
            "revision": comparison["revision"],
            "suggestion_id": suggestion_id,
            "claim_id": claim["id"],
            "survivor_id": survivor_id,
            "survivor_confirmed": True,
            "fact_choices": {field["key"]: survivor_id for field in comparison["decision_fields"]},
            "image_ids": [],
            "images_confirmed": True,
            "warning_confirmed": True,
        },
        format="json",
    )
    assert response.status_code == 201, response.data


@pytest.fixture
def source() -> Source:
    return Source.objects.create(
        name="group-consistency-source",
        domain="group-consistency.example",
        display_name="منبع سنجش گروه",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )


@pytest.mark.django_db
def test_grouped_properties_lists_every_current_multi_listing_group_and_restricts_evidence(
    api_client: APIClient, source: Source
):
    grouped, first = make_property(source, "LEGACY-A")
    _, second = make_property(source, "LEGACY-B")
    second.property = grouped
    second.state = ListingState.REJECTED
    second.save(update_fields=["property", "state"])
    single, _ = make_property(source, "SINGLE")

    api_client.force_authenticate(make_operator())
    response = api_client.get("/api/v1/operator/catalog-curation/grouped-properties/")

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["id"] == str(grouped.pk)
    assert response.data["results"][0]["listing_count"] == 2
    assert response.data["results"][0]["measurement_status"] == "not_measured"
    assert response.data["results"][0]["attention_status"] == "not_measured"
    assert str(single.pk) not in {item["id"] for item in response.data["results"]}

    api_client.force_authenticate(make_operator(can_curate=False))
    assert (
        api_client.get("/api/v1/operator/catalog-curation/grouped-properties/").status_code == 403
    )
    assert first.property_id == grouped.pk


@pytest.mark.django_db
def test_grouped_properties_filters_and_orders_operational_statuses(
    api_client: APIClient, source: Source
):
    stable, _ = make_property(source, "STABLE-A")
    _, stable_second = make_property(source, "STABLE-B")
    stable_second.property = stable
    stable_second.save(update_fields=["property"])
    attention, _ = make_property(source, "ATTENTION-A", area_sqm=90)
    attention_origin, attention_second = make_property(source, "ATTENTION-B", area_sqm=180)
    attention_second.property = attention
    attention_second.source_claims = {"area_sqm": [180, "180"]}
    attention_second.save(update_fields=["property", "source_claims"])
    attention.listings.first().source_claims = {"area_sqm": [90, "90"]}
    attention.listings.first().save(update_fields=["source_claims"])
    ListingGroupingEvent.objects.create(
        listing=attention_second,
        from_property=attention_origin,
        to_property=attention,
        action=ListingGroupingAction.MERGE,
        reason="recent correction",
    )
    stable_measurement = measure_group_consistency(stable.pk)
    attention_measurement = measure_group_consistency(attention.pk)
    assert stable_measurement is not None
    assert attention_measurement is not None
    PropertyGroupConsistencyMeasurement.objects.filter(pk=attention_measurement.pk).update(
        needs_attention=True
    )
    attention_measurement.refresh_from_db()
    assert attention_measurement.needs_attention is True
    api_client.force_authenticate(make_operator())

    response = api_client.get(
        "/api/v1/operator/catalog-curation/grouped-properties/",
        {
            "q": str(attention.pk),
            "attention": "needs_attention",
            "changed": "recent",
            "measurement_status": "measured",
            "scoring_version": attention_measurement.scoring_version,
            "ordering": "measurement_status",
        },
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.data["results"]] == [str(attention.pk)]

    stable_response = api_client.get(
        "/api/v1/operator/catalog-curation/grouped-properties/",
        {"stability": "stable", "ordering": "stability"},
    )
    assert stable_response.status_code == 200
    assert [item["id"] for item in stable_response.data["results"]] == [str(stable.pk)]


@pytest.mark.django_db
def test_current_measurement_uses_all_listing_states_and_missing_evidence_is_not_a_contradiction(
    source: Source,
):
    grouped, _ = make_property(source, "ACTIVE")
    states = [
        ListingState.DRAFT,
        ListingState.REJECTED,
        ListingState.EXPIRED,
        ListingState.UNAVAILABLE,
        ListingState.ARCHIVED,
    ]
    for index, state in enumerate(states):
        _, listing = make_property(source, f"HISTORICAL-{index}")
        listing.property = grouped
        listing.state = state
        listing.save(update_fields=["property", "state"])

    measurement = measure_group_consistency(grouped.pk)

    assert measurement is not None
    assert measurement.scoring_version == SCORING_VERSION
    assert measurement.listing_count == 6
    assert len(measurement.pair_measurements) == 15
    assert {pair["status"] for pair in measurement.pair_measurements} == {"missing_evidence"}
    assert measurement.explicit_contradictions == []
    assert measurement.needs_attention is False


@pytest.mark.django_db
def test_legacy_group_scores_listing_level_claims_and_images(source: Source):
    grouped, left = make_property(source, "LEGACY-EVIDENCE-A")
    _, right = make_property(source, "LEGACY-EVIDENCE-B")
    left.source_claims = {"area_sqm": [90, "90"]}
    left.save(update_fields=["source_claims"])
    right.property = grouped
    right.source_claims = {"area_sqm": [180, "180"]}
    right.save(update_fields=["property", "source_claims"])
    ListingImage.objects.create(
        listing=left,
        position=0,
        raw_content_sha256="a" * 64,
        normalized_pixel_sha256="b" * 64,
        perceptual_dhash="0000000000000001",
    )
    ListingImage.objects.create(
        listing=right,
        position=0,
        raw_content_sha256="c" * 64,
        normalized_pixel_sha256="d" * 64,
        perceptual_dhash="fffffffffffffffe",
    )

    measurement = measure_group_consistency(grouped.pk)

    assert measurement is not None
    assert {pair["status"] for pair in measurement.pair_measurements} == {"measured"}
    assert {item["key"] for item in measurement.explicit_contradictions} == {
        "area_sqm",
        "images",
    }
    assert measurement.needs_attention is True


@pytest.mark.django_db
def test_legacy_group_keeps_ambiguous_raw_claims_as_missing_evidence(source: Source):
    grouped, left = make_property(source, "AMBIGUOUS-A")
    _, right = make_property(source, "AMBIGUOUS-B")
    left.source_claims = {"area_sqm": [90, 91]}
    left.save(update_fields=["source_claims"])
    right.property = grouped
    right.source_claims = {"area_sqm": [180]}
    right.save(update_fields=["property", "source_claims"])

    measurement = measure_group_consistency(grouped.pk)

    assert measurement is not None
    assert {pair["status"] for pair in measurement.pair_measurements} == {"missing_evidence"}
    assert measurement.needs_attention is False


@pytest.mark.django_db
def test_draft_only_incomplete_group_is_included_without_title_failure(
    api_client: APIClient, source: Source
):
    grouped, first = make_property(source, "INCOMPLETE-A")
    _, second = make_property(source, "INCOMPLETE-B")
    second.property = grouped
    second.save(update_fields=["property"])
    Listing.objects.filter(pk__in=(first.pk, second.pk)).update(state=ListingState.DRAFT)
    grouped.property_type = ""
    grouped.neighborhood = None
    grouped.save(update_fields=["property_type", "neighborhood"])
    api_client.force_authenticate(make_operator())

    response = api_client.get("/api/v1/operator/catalog-curation/grouped-properties/")

    assert response.status_code == 200
    assert response.data["results"][0]["id"] == str(grouped.pk)
    assert response.data["results"][0]["title"] == "ملک بدون نوع ثبت‌شده"


@pytest.mark.django_db
def test_group_history_keeps_split_event_after_listing_leaves_group(
    api_client: APIClient, source: Source
):
    grouped, _ = make_property(source, "SPLIT-A")
    separate, moved = make_property(source, "SPLIT-B")
    _, remaining = make_property(source, "SPLIT-C")
    for listing in (moved, remaining):
        listing.property = grouped
        listing.save(update_fields=["property"])
    split_listing(listing=moved, separate_property=separate, reason="واحد متفاوت")
    api_client.force_authenticate(make_operator())

    detail = api_client.get(f"/api/v1/operator/catalog-curation/grouped-properties/{grouped.pk}/")

    assert detail.status_code == 200
    assert [(item["listing_id"], item["action"]) for item in detail.data["grouping_history"]] == [
        (str(moved.pk), "split")
    ]
    assert detail.data["last_grouping_change"] is not None


@pytest.mark.django_db
def test_measurement_marks_reliable_historical_contradiction_as_needs_attention(
    api_client: APIClient, source: Source
):
    survivor, survivor_listing = make_property(source, "SURVIVOR", area_sqm=90)
    contradictory, contradictory_listing = make_property(source, "CONTRADICTION", area_sqm=180)
    contradictory.latitude = Decimal("35.800000")
    contradictory.longitude = Decimal("51.400000")
    contradictory.save(update_fields=["latitude", "longitude"])
    merge_properties(target=survivor, duplicate=contradictory, reason="legacy repair")

    measurement = measure_group_consistency(survivor.pk)
    api_client.force_authenticate(make_operator())
    detail = api_client.get(f"/api/v1/operator/catalog-curation/grouped-properties/{survivor.pk}/")

    assert measurement is not None
    assert measurement.needs_attention is True
    assert measurement.strongest_pair is not None
    assert measurement.weakest_pair is not None
    assert measurement.weakest_pair["listing_ids"] == sorted([
        str(survivor_listing.pk),
        str(contradictory_listing.pk),
    ])
    assert {item["classification"] for item in measurement.explicit_contradictions} >= {"blocker"}
    assert detail.status_code == 200
    assert detail.data["attention_status"] == "needs_attention"
    assert detail.data["measurement"]["scoring_version"] == SCORING_VERSION
    assert detail.data["grouping_history"][0]["reason"] == "legacy repair"
    assert detail.data["approved_connections"] == []


@pytest.mark.django_db
def test_low_weight_contradiction_is_explicit_without_marking_needs_attention(source: Source):
    survivor, _ = make_property(source, "LOW-A")
    contradictory, _ = make_property(source, "LOW-B")
    contradictory.parking = "absent"
    contradictory.save(update_fields=["parking"])
    merge_properties(target=survivor, duplicate=contradictory)

    measurement = measure_group_consistency(survivor.pk)

    assert measurement is not None
    assert {item["key"] for item in measurement.explicit_contradictions} == {"features"}
    assert measurement.needs_attention is False


@pytest.mark.django_db
def test_group_consistency_reconciliation_is_bounded_and_idempotent(source: Source):
    groups = []
    for index in range(3):
        property_, _ = make_property(source, f"GROUP-{index}-A")
        _, listing = make_property(source, f"GROUP-{index}-B")
        listing.property = property_
        listing.save(update_fields=["property"])
        groups.append(property_)

    first = reconcile_grouped_property_consistency(limit=2)
    second = reconcile_grouped_property_consistency(limit=2, after_id=first["next_after_id"])
    repeat = reconcile_grouped_property_consistency(limit=2, after_id=first["next_after_id"])

    assert first["processed"] == 2
    assert first["next_after_id"] is not None
    assert second["processed"] == 1
    assert second["next_after_id"] is None
    assert repeat["processed"] == 1
    assert PropertyGroupConsistencyMeasurement.objects.count() == 3


@pytest.mark.django_db
def test_group_consistency_reconciliation_rejects_overlap_and_stale_delivery(source: Source):
    grouped, _ = make_property(source, "FENCED-A")
    _, listing = make_property(source, "FENCED-B")
    listing.property = grouped
    listing.save(update_fields=["property"])
    cache.set(GROUP_CONSISTENCY_RECONCILIATION_LOCK, "active-run", timeout=60)

    overlap = reconcile_grouped_property_consistency(limit=10)
    stale = reconcile_grouped_property_consistency(limit=10, run_token="stale-run")

    assert overlap == {"status": "already_running", "processed": 0, "next_after_id": None}
    assert stale == {"status": "stale_delivery", "processed": 0, "next_after_id": None}
    assert PropertyGroupConsistencyMeasurement.objects.count() == 0


@pytest.mark.django_db
def test_suggestion_group_detail_shows_approved_graph_and_indirect_listing_connections(
    api_client: APIClient, source: Source
):
    property_a, listing_a = make_property(source, "A")
    property_b, listing_b = make_property(source, "B")
    property_c, listing_c = make_property(source, "C")
    suggestion_ab = evaluate_property_pair(property_a.pk, property_b.pk, origin="focused")
    suggestion_bc = evaluate_property_pair(property_b.pk, property_c.pk, origin="focused")
    assert suggestion_ab is not None
    assert suggestion_bc is not None
    api_client.force_authenticate(make_operator())

    approve_suggestion(api_client, str(suggestion_ab.pk), survivor_id=str(property_a.pk))
    suggestion_bc.refresh_from_db()
    assert suggestion_bc.rebased_to is not None
    approve_suggestion(
        api_client,
        str(suggestion_bc.rebased_to_id),
        survivor_id=str(property_a.pk),
    )
    measure_group_consistency(property_a.pk)

    detail = api_client.get(
        f"/api/v1/operator/catalog-curation/grouped-properties/{property_a.pk}/"
    )

    assert detail.status_code == 200
    assert len(detail.data["approved_connections"]) == 2
    assert len(detail.data["measurement"]["pair_measurements"]) == 3
    indirect_listing_pairs = {
        frozenset(item["listing_ids"]) for item in detail.data["indirect_only_connections"]
    }
    assert frozenset((str(listing_b.pk), str(listing_c.pk))) in indirect_listing_pairs
    assert frozenset((str(listing_a.pk), str(listing_b.pk))) not in indirect_listing_pairs


@pytest.mark.django_db
def test_old_scoring_version_is_reported_as_stale_not_current(
    api_client: APIClient, source: Source
):
    grouped, _ = make_property(source, "OLD-A")
    _, listing = make_property(source, "OLD-B")
    listing.property = grouped
    listing.save(update_fields=["property"])
    measurement = measure_group_consistency(grouped.pk)
    assert measurement is not None
    measurement.scoring_version = "property-match-v1"
    measurement.save(update_fields=["scoring_version"])
    api_client.force_authenticate(make_operator())

    detail = api_client.get(f"/api/v1/operator/catalog-curation/grouped-properties/{grouped.pk}/")

    assert detail.status_code == 200
    assert detail.data["measurement_status"] == "stale"
    assert detail.data["attention_status"] == "not_measured"
    assert detail.data["measurement"] is None


@pytest.mark.django_db
def test_default_group_order_prioritizes_attention_recent_stable_then_unmeasured(
    api_client: APIClient, source: Source
):
    needs_attention, _ = make_property(source, "ATTENTION-A", area_sqm=90)
    contradiction, _ = make_property(source, "ATTENTION-B", area_sqm=180)
    merge_properties(target=needs_attention, duplicate=contradiction)
    measure_group_consistency(needs_attention.pk)

    recent, _ = make_property(source, "RECENT-A")
    recent_source, _ = make_property(source, "RECENT-B")
    merge_properties(target=recent, duplicate=recent_source)
    measure_group_consistency(recent.pk)

    stable, _ = make_property(source, "STABLE-A")
    _, stable_listing = make_property(source, "STABLE-B")
    stable_listing.property = stable
    stable_listing.save(update_fields=["property"])
    measure_group_consistency(stable.pk)

    unmeasured, _ = make_property(source, "UNMEASURED-A")
    _, unmeasured_listing = make_property(source, "UNMEASURED-B")
    unmeasured_listing.property = unmeasured
    unmeasured_listing.save(update_fields=["property"])
    api_client.force_authenticate(make_operator())

    response = api_client.get("/api/v1/operator/catalog-curation/grouped-properties/")

    assert response.status_code == 200
    assert [item["attention_status"] for item in response.data["results"]] == [
        "needs_attention",
        "recent_change",
        "stable",
        "not_measured",
    ]
