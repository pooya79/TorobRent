import uuid
from decimal import Decimal

import pytest
from django.conf import settings
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.core.management import call_command
from django.db.models import Q
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.match_suggestion_signals import (
    FOCUSED_MEASUREMENT_DIRTY_KEY,
    FOCUSED_MEASUREMENT_KEY,
    _dispatch_focused_measurement,
)
from apps.catalog.match_suggestions import candidate_property_ids
from apps.catalog.models import (
    Listing,
    ListingImage,
    ListingImagePerceptualBucket,
    ListingState,
    Neighborhood,
    OutboundPolicy,
    Property,
    PropertyMatchSuggestion,
    PropertyMatchSuggestionState,
    PropertyType,
    RentalTerms,
    Source,
)
from apps.catalog.tasks import (
    PROPERTY_MATCH_RECONCILIATION_LOCK,
    PROPERTY_MATCH_RECONCILIATION_TIMEOUT,
    measure_property_match_candidates,
    reconcile_property_match_suggestions,
)


def make_operator() -> User:
    operator = User.objects.create_user(
        email="suggestions@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(Permission.objects.get(codename="curate_catalog"))
    return operator


def make_property(
    source: Source,
    reference: str,
    *,
    state: str = ListingState.PUBLISHED,
    latitude: Decimal | None = Decimal("35.774100"),
    longitude: Decimal | None = Decimal("51.356200"),
    area_sqm: int = 90,
    property_id: str | None = None,
) -> Property:
    if not Neighborhood.objects.exists():
        call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    property_ = Property.objects.create(
        id=property_id,
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
        latitude=latitude,
        longitude=longitude,
    )
    Listing.objects.create(
        property=property_,
        source=source,
        terms=RentalTerms.objects.create(
            deposit_rial=5_000_000_000,
            monthly_rent_rial=300_000_000,
        ),
        state=state,
        source_reference=reference,
        external_url=f"https://{source.domain}/{reference}",
        available_until=timezone.now() + timezone.timedelta(days=14),
    )
    return property_


@pytest.mark.django_db
def test_focused_measurement_persists_one_current_pair_and_appends_history():
    source = Source.objects.create(
        name="suggestion-source",
        domain="suggestions.example",
        display_name="منبع پیشنهاد",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    left = make_property(source, "LEFT")
    right = make_property(
        source,
        "RIGHT",
        latitude=Decimal("35.774120"),
        longitude=Decimal("51.356180"),
    )

    first = measure_property_match_candidates(property_id=str(left.pk), limit=25)
    second = measure_property_match_candidates(property_id=str(right.pk), limit=25)

    suggestion = PropertyMatchSuggestion.objects.get()
    assert first["evaluated"] == 1
    assert second["evaluated"] == 1
    assert suggestion.left_id == min(left.pk, right.pk)
    assert suggestion.right_id == max(left.pk, right.pk)
    assert suggestion.state == PropertyMatchSuggestionState.PENDING
    assert suggestion.band == "likely"
    assert suggestion.score == 100
    assert suggestion.scoring_version == "property-match-v2"
    assert suggestion.evidence_fingerprint
    assert suggestion.left_revision
    assert suggestion.right_revision
    assert suggestion.evaluations.count() == 2


@pytest.mark.django_db
def test_candidate_generation_uses_the_bounded_union_of_identity_indexes():
    source = Source.objects.create(
        name="candidate-source",
        domain="candidates.example",
        display_name="منبع نامزد",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    focus = make_property(source, "FOCUS")
    coordinate = make_property(
        source,
        "COORDINATE",
        latitude=Decimal("35.774120"),
        longitude=Decimal("51.356180"),
        area_sqm=310,
    )
    fact_bucket = make_property(source, "FACTS", latitude=None, longitude=None, area_sqm=92)
    image_hash = make_property(source, "IMAGE", latitude=None, longitude=None, area_sqm=320)
    building = make_property(source, "BUILDING", latitude=None, longitude=None, area_sqm=330)
    unrelated = make_property(source, "UNRELATED", latitude=None, longitude=None, area_sqm=500)
    other_neighborhood = Neighborhood.objects.exclude(pk=focus.neighborhood_id).first()
    assert other_neighborhood is not None
    for property_ in (coordinate, image_hash, building, unrelated):
        property_.neighborhood = other_neighborhood
        property_.district = other_neighborhood.district
        property_.property_type = PropertyType.OFFICE
        property_.floor = None
        property_.total_floors = None
        property_.units_per_floor = None
        property_.save()
    building.total_floors = focus.total_floors
    building.units_per_floor = focus.units_per_floor
    building.save(update_fields=["total_floors", "units_per_floor"])
    ListingImage.objects.create(
        listing=focus.listings.get(),
        position=0,
        raw_content_sha256="a" * 64,
        normalized_pixel_sha256="b" * 64,
        perceptual_dhash="1234567890abcdef",
    )
    ListingImage.objects.create(
        listing=image_hash.listings.get(),
        position=0,
        raw_content_sha256="c" * 64,
        normalized_pixel_sha256="d" * 64,
        perceptual_dhash="0234567890abcdef",
    )

    candidates = candidate_property_ids(focus, limit=10)

    assert set(candidates) == {coordinate.pk, fact_bucket.pk, image_hash.pk, building.pk}
    assert unrelated.pk not in candidates
    assert ListingImagePerceptualBucket.objects.count() == 32


@pytest.mark.django_db
def test_saturated_candidate_union_reserves_space_for_exact_image_matches():
    source = Source.objects.create(
        name="saturated-source",
        domain="saturated.example",
        display_name="منبع اشباع",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    focus = make_property(source, "FOCUS", property_id="80000000-0000-0000-0000-000000000000")
    for number in range(8):
        make_property(
            source,
            f"COORDINATE-{number}",
            area_sqm=300 + number,
            property_id=f"00000000-0000-0000-0000-{number + 1:012d}",
        )
    image_match = make_property(
        source,
        "IMAGE",
        latitude=None,
        longitude=None,
        area_sqm=500,
        property_id="ffffffff-ffff-ffff-ffff-ffffffffffff",
    )
    other_neighborhood = Neighborhood.objects.exclude(pk=focus.neighborhood_id).first()
    assert other_neighborhood is not None
    image_match.neighborhood = other_neighborhood
    image_match.district = other_neighborhood.district
    image_match.property_type = PropertyType.OFFICE
    image_match.save()
    ListingImage.objects.create(
        listing=focus.listings.get(),
        position=0,
        raw_content_sha256="a" * 64,
    )
    ListingImage.objects.create(
        listing=image_match.listings.get(),
        position=0,
        raw_content_sha256="a" * 64,
    )

    candidates = candidate_property_ids(focus, limit=4)

    assert len(candidates) == 4
    assert uuid.UUID(str(image_match.pk)) in candidates


@pytest.mark.django_db
def test_saturated_perceptual_path_ranks_shared_buckets_before_truncation():
    source = Source.objects.create(
        name="perceptual-saturation-source",
        domain="perceptual-saturation.example",
        display_name="منبع اشباع تصویر",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    focus = make_property(
        source,
        "FOCUS",
        property_id="80000000-0000-0000-0000-000000000000",
    )
    ListingImage.objects.create(
        listing=focus.listings.get(),
        position=0,
        perceptual_dhash="0123456789abcdef",
    )
    other_neighborhood = Neighborhood.objects.exclude(pk=focus.neighborhood_id).first()
    assert other_neighborhood is not None
    for number in range(8):
        distractor = make_property(
            source,
            f"DISTRACTOR-{number}",
            latitude=None,
            longitude=None,
            area_sqm=300 + number,
            property_id=f"00000000-0000-0000-0000-{number + 1:012d}",
        )
        distractor.neighborhood = other_neighborhood
        distractor.district = other_neighborhood.district
        distractor.property_type = PropertyType.OFFICE
        distractor.floor = None
        distractor.total_floors = None
        distractor.units_per_floor = None
        distractor.save()
        ListingImage.objects.create(
            listing=distractor.listings.get(),
            position=0,
            perceptual_dhash="0fffffffffffffff",
        )
    image_match = make_property(
        source,
        "IMAGE",
        latitude=None,
        longitude=None,
        area_sqm=500,
        property_id="ffffffff-ffff-ffff-ffff-ffffffffffff",
    )
    image_match.neighborhood = other_neighborhood
    image_match.district = other_neighborhood.district
    image_match.property_type = PropertyType.OFFICE
    image_match.floor = None
    image_match.total_floors = None
    image_match.units_per_floor = None
    image_match.save()
    ListingImage.objects.create(
        listing=image_match.listings.get(),
        position=0,
        perceptual_dhash="0123457698badcfe",
    )

    candidates = candidate_property_ids(focus, limit=4)

    assert uuid.UUID(str(image_match.pk)) in candidates


@pytest.mark.django_db
def test_focused_measurement_supersedes_a_pending_pair_that_left_every_candidate_bucket():
    source = Source.objects.create(
        name="stale-source",
        domain="stale.example",
        display_name="منبع شواهد قدیمی",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    left = make_property(source, "LEFT")
    right = make_property(source, "RIGHT")
    measure_property_match_candidates(property_id=str(left.pk), limit=25)
    suggestion = PropertyMatchSuggestion.objects.get()
    other_neighborhood = Neighborhood.objects.exclude(pk=left.neighborhood_id).first()
    assert other_neighborhood is not None
    right.neighborhood = other_neighborhood
    right.district = other_neighborhood.district
    right.property_type = PropertyType.OFFICE
    right.area_sqm = 500
    right.latitude = None
    right.longitude = None
    right.floor = None
    right.total_floors = None
    right.units_per_floor = None
    right.save()

    result = measure_property_match_candidates(property_id=str(right.pk), limit=25)

    suggestion.refresh_from_db()
    assert result == {"evaluated": 1, "active": 0}
    assert suggestion.state == PropertyMatchSuggestionState.SUPERSEDED
    assert suggestion.evaluations.count() == 2


@pytest.mark.django_db
def test_repeated_bounded_measurement_reaches_stale_pairs_behind_an_active_pair():
    source = Source.objects.create(
        name="stale-page-source",
        domain="stale-page.example",
        display_name="منبع صفحه‌بندی شواهد",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    focus = make_property(source, "FOCUS")
    active = make_property(source, "ACTIVE")
    stale = [make_property(source, f"STALE-{number}") for number in range(2)]
    measure_property_match_candidates(property_id=str(focus.pk), limit=10)
    other_neighborhood = Neighborhood.objects.exclude(pk=focus.neighborhood_id).first()
    assert other_neighborhood is not None
    for property_ in stale:
        property_.neighborhood = other_neighborhood
        property_.district = other_neighborhood.district
        property_.property_type = PropertyType.OFFICE
        property_.area_sqm = 500
        property_.latitude = None
        property_.longitude = None
        property_.floor = None
        property_.total_floors = None
        property_.units_per_floor = None
        property_.save()

    for _ in range(3):
        measure_property_match_candidates(property_id=str(focus.pk), limit=1)

    assert PropertyMatchSuggestion.objects.filter(
        Q(left_id=focus.pk, right_id=active.pk) | Q(left_id=active.pk, right_id=focus.pk),
        state=PropertyMatchSuggestionState.PENDING,
    ).exists()
    assert not PropertyMatchSuggestion.objects.filter(
        Q(left_id=focus.pk, right_id__in=[property_.pk for property_ in stale])
        | Q(right_id=focus.pk, left_id__in=[property_.pk for property_ in stale]),
        state=PropertyMatchSuggestionState.PENDING,
    ).exists()


@pytest.mark.django_db
def test_pending_neighbors_do_not_consume_the_fresh_candidate_budget():
    source = Source.objects.create(
        name="discovery-budget-source",
        domain="discovery-budget.example",
        display_name="منبع بودجه کشف",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    focus = make_property(source, "FOCUS")
    existing = make_property(source, "EXISTING")
    measure_property_match_candidates(property_id=str(focus.pk), limit=1)
    assert PropertyMatchSuggestion.objects.filter(
        Q(left_id=focus.pk, right_id=existing.pk) | Q(left_id=existing.pk, right_id=focus.pk)
    ).exists()
    discovered = make_property(source, "DISCOVERED")
    ListingImage.objects.create(
        listing=focus.listings.get(), position=0, raw_content_sha256="d" * 64
    )
    ListingImage.objects.create(
        listing=discovered.listings.get(), position=0, raw_content_sha256="d" * 64
    )

    result = measure_property_match_candidates(property_id=str(focus.pk), limit=1)

    assert result["evaluated"] == 2
    assert PropertyMatchSuggestion.objects.filter(
        Q(left_id=focus.pk, right_id=discovered.pk) | Q(left_id=discovered.pk, right_id=focus.pk)
    ).exists()


@pytest.mark.django_db
def test_measurement_excludes_draft_and_rejected_evidence_and_supersedes_threshold_drop():
    source = Source.objects.create(
        name="eligibility-source",
        domain="eligibility.example",
        display_name="منبع وضعیت",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    left = make_property(source, "LEFT")
    right = make_property(source, "RIGHT")
    make_property(source, "DRAFT", state=ListingState.DRAFT)
    make_property(source, "REJECTED", state=ListingState.REJECTED)

    measure_property_match_candidates(property_id=str(left.pk), limit=25)
    suggestion = PropertyMatchSuggestion.objects.get()
    right.latitude = Decimal("35.790000")
    right.longitude = Decimal("51.390000")
    right.save(update_fields=["latitude", "longitude"])

    measure_property_match_candidates(property_id=str(left.pk), limit=25)

    suggestion.refresh_from_db()
    assert suggestion.state == PropertyMatchSuggestionState.SUPERSEDED
    assert suggestion.score == 0
    assert suggestion.evaluations.count() == 2
    assert not PropertyMatchSuggestion.objects.filter(
        left__listings__state__in=[ListingState.DRAFT, ListingState.REJECTED]
    ).exists()


@pytest.mark.django_db
def test_suggestions_api_defaults_to_unclaimed_likely_pairs_in_queue_order(
    api_client: APIClient,
):
    source = Source.objects.create(
        name="queue-source",
        domain="queue.example",
        display_name="منبع صف",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    first = make_property(source, "FIRST")
    second = make_property(source, "SECOND")
    measure_property_match_candidates(property_id=str(first.pk), limit=25)
    api_client.force_authenticate(make_operator())

    response = api_client.get("/api/v1/operator/catalog-curation/suggestions/")

    assert response.status_code == 200
    assert response.data["count"] == 1
    item = response.data["results"][0]
    assert item["band"] == "likely"
    assert item["state"] == "pending"
    assert item["claim"] is None
    assert item["property_ids"] == [str(min(first.pk, second.pk)), str(max(first.pk, second.pk))]
    assert item["evidence_summary"]
    assert response.data["filters"] == {
        "band": "likely",
        "claim": "unclaimed",
        "ordering": "confidence",
    }


@pytest.mark.django_db
def test_suggestion_detail_exposes_current_comparison_without_public_leak(api_client: APIClient):
    source = Source.objects.create(
        name="detail-source",
        domain="detail.example",
        display_name="منبع جزئیات",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    left = make_property(source, "LEFT")
    make_property(source, "RIGHT")
    measure_property_match_candidates(property_id=str(left.pk), limit=25)
    suggestion = PropertyMatchSuggestion.objects.get()
    api_client.force_authenticate(make_operator())

    response = api_client.get(f"/api/v1/operator/catalog-curation/suggestions/{suggestion.pk}/")

    assert response.status_code == 200
    assert response.data["id"] == str(suggestion.pk)
    assert response.data["comparison"]["score"] == suggestion.score
    assert response.data["comparison"]["revision"]
    assert len(response.data["comparison"]["properties"]) == 2
    public = api_client.get(f"/api/v1/catalog/properties/{left.pk}/")
    assert "evidence_fingerprint" not in str(public.data)


@pytest.mark.django_db
def test_nightly_reconciliation_is_bounded_retry_safe_and_fenced():
    source = Source.objects.create(
        name="nightly-source",
        domain="nightly.example",
        display_name="منبع شبانه",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    for number in range(3):
        make_property(source, f"NIGHT-{number}")

    first = reconcile_property_match_suggestions(limit=2)
    retry = reconcile_property_match_suggestions(limit=2)
    assert first["status"] == "completed"
    assert first["processed"] == 2
    assert first["next_after_id"]
    assert retry["status"] == "completed"
    assert PropertyMatchSuggestion.objects.count() == 3

    cache.add(PROPERTY_MATCH_RECONCILIATION_LOCK, True, timeout=60)
    try:
        overlapping = reconcile_property_match_suggestions(limit=2)
    finally:
        cache.delete(PROPERTY_MATCH_RECONCILIATION_LOCK)
    assert overlapping == {
        "status": "already_running",
        "processed": 0,
        "next_after_id": None,
    }


@pytest.mark.django_db
def test_duplicate_reconciliation_page_delivery_is_fenced(monkeypatch):
    source = Source.objects.create(
        name="delivery-source",
        domain="delivery.example",
        display_name="منبع تحویل",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    for number in range(3):
        make_property(source, f"DELIVERY-{number}")
    token = "same-run-token"
    cache.set(PROPERTY_MATCH_RECONCILIATION_LOCK, token, timeout=60)
    monkeypatch.setattr(reconcile_property_match_suggestions, "delay", lambda **_kwargs: None)
    try:
        first = reconcile_property_match_suggestions(limit=2, run_token=token)
        duplicate = reconcile_property_match_suggestions(limit=2, run_token=token)
    finally:
        cache.delete(PROPERTY_MATCH_RECONCILIATION_LOCK)
    assert first["status"] == "completed"
    assert duplicate == {
        "status": "duplicate_delivery",
        "processed": 0,
        "next_after_id": None,
    }


def test_reconciliation_lease_outlives_the_celery_hard_time_limit():
    assert PROPERTY_MATCH_RECONCILIATION_TIMEOUT > settings.CELERY_TASK_TIME_LIMIT


@pytest.mark.django_db
def test_focused_mutation_during_active_measurement_schedules_a_follow_up(monkeypatch):
    source = Source.objects.create(
        name="dirty-source",
        domain="dirty.example",
        display_name="منبع تغییر همزمان",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    property_ = make_property(source, "DIRTY")
    key = FOCUSED_MEASUREMENT_KEY.format(property_id=property_.pk)
    dirty_key = FOCUSED_MEASUREMENT_DIRTY_KEY.format(property_id=property_.pk)
    cache.set(key, True, timeout=60)
    delayed: list[dict[str, object]] = []
    monkeypatch.setattr(
        measure_property_match_candidates,
        "delay",
        lambda **kwargs: delayed.append(kwargs),
    )

    _dispatch_focused_measurement(property_.pk)
    assert cache.get(dirty_key) is True

    measure_property_match_candidates(property_id=str(property_.pk), limit=1)

    assert delayed == [{"property_id": str(property_.pk), "limit": 100}]


@pytest.mark.django_db(transaction=True)
def test_listing_publication_enqueues_focused_measurement_without_delaying_publication(
    django_capture_on_commit_callbacks,
):
    source = Source.objects.create(
        name="publication-source",
        domain="publication.example",
        display_name="منبع انتشار",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    make_property(source, "FIRST")

    with django_capture_on_commit_callbacks(execute=True):
        second = make_property(source, "SECOND")

    second_listing = second.listings.get()
    assert second_listing.state == ListingState.PUBLISHED
    suggestion = PropertyMatchSuggestion.objects.get(
        left_id=min(second.pk, Property.objects.exclude(pk=second.pk).get().pk),
        right_id=max(second.pk, Property.objects.exclude(pk=second.pk).get().pk),
    )
    assert suggestion.evaluations.count() == 1
