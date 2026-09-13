import uuid
from io import StringIO

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.catalog import group_consistency, match_operations, match_suggestions, matching
from apps.catalog.group_consistency import measure_group_consistency
from apps.catalog.match_suggestions import candidate_property_ids, measure_candidates_for_property
from apps.catalog.models import (
    ListingState,
    OutboundPolicy,
    PropertyGroupConsistencyMeasurement,
    PropertyMatchDecision,
    PropertyMatchOperation,
    PropertyMatchSuggestion,
    Source,
)
from apps.catalog.tasks import backfill_property_matching, rescore_property_matching
from tests.test_property_match_suggestions import claim_suggestion, make_operator, make_property


@pytest.mark.django_db
def test_empty_catalog_backfill_completes_with_observable_progress():
    operation_id = uuid.uuid4()

    result = backfill_property_matching(
        operation_id=str(operation_id),
        limit=2,
        generation=0,
    )

    operation = PropertyMatchOperation.objects.get(pk=operation_id)
    assert result == {
        "operation_id": str(operation_id),
        "status": "completed",
        "phase": "completed",
        "generation": 1,
        "processed_targets": 0,
        "evaluated_pairs": 0,
        "active_suggestions": 0,
        "measured_groups": 0,
    }
    assert operation.status == "completed"
    assert operation.completed_at is not None
    assert operation.error_code == ""


@pytest.mark.django_db
def test_backfill_is_bounded_idempotent_and_never_changes_grouping(monkeypatch):
    source = Source.objects.create(
        name="backfill-source",
        domain="backfill.example",
        display_name="منبع پس‌پرکردن",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    likely_left = make_property(source, "LIKELY-LEFT")
    make_property(source, "LIKELY-RIGHT")
    weak = make_property(source, "WEAK", latitude=None, longitude=None, area_sqm=100)
    weak.property_type = "office"
    weak.room_count = 5
    weak.floor = 12
    weak.total_floors = 20
    weak.units_per_floor = 8
    weak.parking = "absent"
    weak.elevator = "absent"
    weak.save()
    empty_shell = make_property(source, "GROUPED-LISTING", state=ListingState.ARCHIVED)
    grouped_listing = empty_shell.listings.get()
    grouped_listing.property = likely_left
    grouped_listing.save(update_fields=["property"])
    original_membership = list(likely_left.listings.order_by("pk").values_list("pk", "property_id"))
    monkeypatch.setattr(backfill_property_matching, "delay", lambda **_kwargs: None)
    operation_id = uuid.uuid4()
    generation = 0

    while True:
        result = backfill_property_matching(
            operation_id=str(operation_id),
            limit=1,
            generation=generation,
        )
        if result["status"] == "completed":
            break
        generation = int(result["generation"])

    operation = PropertyMatchOperation.objects.get(pk=operation_id)
    assert operation.processed_targets == 4
    assert operation.measured_groups == 1
    assert PropertyGroupConsistencyMeasurement.objects.count() == 1
    assert PropertyMatchSuggestion.objects.filter(state="pending", band="likely").exists()
    assert PropertyMatchSuggestion.objects.filter(
        state="superseded", band="below_threshold"
    ).exists()
    assert PropertyMatchSuggestion.objects.count() == 3
    assert sum(item.evaluations.count() for item in PropertyMatchSuggestion.objects.all()) == 3
    assert PropertyMatchDecision.objects.count() == 0
    assert list(likely_left.listings.order_by("pk").values_list("pk", "property_id")) == (
        original_membership
    )

    repeated = backfill_property_matching(
        operation_id=str(operation_id),
        limit=1,
        generation=operation.generation,
    )

    assert repeated["status"] == "completed"
    assert PropertyMatchSuggestion.objects.count() == 3
    assert sum(item.evaluations.count() for item in PropertyMatchSuggestion.objects.all()) == 3
    assert PropertyGroupConsistencyMeasurement.objects.count() == 1


@pytest.mark.django_db
def test_rescore_retains_negative_snooze_and_historical_measurements(
    api_client: APIClient,
    monkeypatch,
):
    source = Source.objects.create(
        name="rescore-operation-source",
        domain="rescore-operation.example",
        display_name="منبع امتیازدهی دوباره",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    focus = make_property(source, "FOCUS")
    rejected_property = make_property(source, "REJECTED")
    snoozed_property = make_property(source, "SNOOZED")
    measure_candidates_for_property(focus.pk, limit=25)
    rejected = PropertyMatchSuggestion.objects.get(
        left_id=min(focus.pk, rejected_property.pk),
        right_id=max(focus.pk, rejected_property.pk),
    )
    snoozed = PropertyMatchSuggestion.objects.get(
        left_id=min(focus.pk, snoozed_property.pk),
        right_id=max(focus.pk, snoozed_property.pk),
    )
    api_client.force_authenticate(make_operator())
    rejected_review = claim_suggestion(api_client, rejected)
    rejected_response = api_client.post(
        f"/api/v1/operator/catalog-curation/suggestions/{rejected.pk}/reject/",
        rejected_review,
        format="json",
    )
    assert rejected_response.status_code == 201
    snoozed_review = claim_suggestion(api_client, snoozed)
    snoozed_response = api_client.post(
        f"/api/v1/operator/catalog-curation/suggestions/{snoozed.pk}/snooze/",
        {**snoozed_review, "days": 30},
        format="json",
    )
    assert snoozed_response.status_code == 201
    grouped = make_property(source, "GROUP-A")
    grouped_shell = make_property(source, "GROUP-B")
    grouped_listing = grouped_shell.listings.get()
    grouped_listing.property = grouped
    grouped_listing.save(update_fields=["property"])
    original_measurement = measure_group_consistency(grouped.pk)
    assert original_measurement is not None
    decision_ids = list(PropertyMatchDecision.objects.order_by("pk").values_list("pk", flat=True))

    monkeypatch.setattr(matching, "SCORING_VERSION", "property-match-v3")
    monkeypatch.setattr(group_consistency, "SCORING_VERSION", "property-match-v3")
    monkeypatch.setattr(match_operations, "SCORING_VERSION", "property-match-v3")
    monkeypatch.setattr(rescore_property_matching, "delay", lambda **_kwargs: None)
    operation_id = uuid.uuid4()
    generation = 0
    while True:
        result = rescore_property_matching(
            operation_id=str(operation_id),
            limit=1,
            generation=generation,
        )
        if result["status"] == "completed":
            break
        generation = int(result["generation"])

    rejected.refresh_from_db()
    snoozed.refresh_from_db()
    assert rejected.state == "rejected"
    assert snoozed.state == "snoozed"
    assert rejected.scoring_version == "property-match-v3"
    assert snoozed.scoring_version == "property-match-v3"
    assert list(rejected.evaluations.values_list("scoring_version", flat=True)) == [
        "property-match-v2",
        "property-match-v3",
    ]
    assert list(snoozed.evaluations.values_list("scoring_version", flat=True)) == [
        "property-match-v2",
        "property-match-v3",
    ]
    assert list(PropertyMatchDecision.objects.order_by("pk").values_list("pk", flat=True)) == (
        decision_ids
    )
    assert set(
        PropertyGroupConsistencyMeasurement.objects.filter(property=grouped).values_list(
            "scoring_version", flat=True
        )
    ) == {"property-match-v2", "property-match-v3"}

    evaluation_count = sum(
        item.evaluations.count() for item in PropertyMatchSuggestion.objects.all()
    )
    measurement_count = PropertyGroupConsistencyMeasurement.objects.count()
    operation = PropertyMatchOperation.objects.get(pk=operation_id)
    rescore_property_matching(
        operation_id=str(operation_id),
        limit=1,
        generation=operation.generation,
    )

    assert sum(item.evaluations.count() for item in PropertyMatchSuggestion.objects.all()) == (
        evaluation_count
    )
    assert PropertyGroupConsistencyMeasurement.objects.count() == measurement_count


@pytest.mark.django_db
def test_rescore_can_reactivate_a_superseded_diagnostic_under_the_new_version(monkeypatch):
    from dataclasses import replace

    source = Source.objects.create(
        name="superseded-rescore-source",
        domain="superseded-rescore.example",
        display_name="منبع عیب‌یابی جایگزین‌شده",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    left = make_property(source, "LEFT", latitude=None, longitude=None)
    right = make_property(source, "RIGHT", latitude=None, longitude=None)
    right.property_type = "office"
    right.room_count = 5
    right.floor = 12
    right.total_floors = 20
    right.units_per_floor = 8
    right.parking = "absent"
    right.elevator = "absent"
    right.save()
    suggestion = match_suggestions.evaluate_property_pair(
        left.pk,
        right.pk,
        origin="backfill",
        persist_inactive=True,
    )
    assert suggestion is not None
    assert suggestion.state == "superseded"
    original_compare = match_suggestions.compare_properties

    def compare_under_new_version(*properties):
        return replace(
            original_compare(*properties),
            score=80,
            band="likely",
            scoring_version="property-match-v3",
        )

    monkeypatch.setattr(match_suggestions, "compare_properties", compare_under_new_version)
    monkeypatch.setattr(match_operations, "SCORING_VERSION", "property-match-v3")
    monkeypatch.setattr(rescore_property_matching, "delay", lambda **_kwargs: None)
    operation_id = uuid.uuid4()
    page = rescore_property_matching(operation_id=str(operation_id), limit=1, generation=0)
    while page["status"] != "completed":
        page = rescore_property_matching(
            operation_id=str(operation_id),
            limit=1,
            generation=int(page["generation"]),
        )

    suggestion.refresh_from_db()
    assert suggestion.state == "pending"
    assert list(suggestion.evaluations.values_list("scoring_version", flat=True)) == [
        "property-match-v2",
        "property-match-v3",
    ]


@pytest.mark.django_db
def test_version_change_between_pages_stops_with_a_safe_terminal_outcome(monkeypatch):
    source = Source.objects.create(
        name="mid-operation-version-source",
        domain="mid-operation-version.example",
        display_name="منبع تغییر نسخه",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    focus = make_property(source, "FOCUS")
    make_property(source, "FIRST")
    make_property(source, "SECOND")
    measure_candidates_for_property(focus.pk, limit=25)
    monkeypatch.setattr(rescore_property_matching, "delay", lambda **_kwargs: None)
    operation_id = uuid.uuid4()
    first_page = rescore_property_matching(
        operation_id=str(operation_id),
        limit=1,
        generation=0,
    )
    evaluation_count = sum(
        item.evaluations.count() for item in PropertyMatchSuggestion.objects.all()
    )
    monkeypatch.setattr(match_operations, "SCORING_VERSION", "property-match-v3")

    stopped = rescore_property_matching(
        operation_id=str(operation_id),
        limit=1,
        generation=int(first_page["generation"]),
    )

    operation = PropertyMatchOperation.objects.get(pk=operation_id)
    assert stopped["status"] == "failed"
    assert operation.error_code == "scoring_version_changed"
    assert operation.completed_at is None
    assert sum(item.evaluations.count() for item in PropertyMatchSuggestion.objects.all()) == (
        evaluation_count
    )


@pytest.mark.django_db
def test_indexed_candidate_pages_cover_candidates_beyond_the_first_page():
    source = Source.objects.create(
        name="candidate-page-source",
        domain="candidate-page.example",
        display_name="منبع صفحه‌بندی نامزد",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    focus = make_property(
        source,
        "FOCUS",
        property_id="10000000-0000-0000-0000-000000000000",
    )
    candidates = [
        make_property(
            source,
            str(index),
            property_id=f"{index}0000000-0000-0000-0000-000000000000",
        )
        for index in (2, 3, 4)
    ]

    first_page = candidate_property_ids(focus, limit=2, after_id=focus.pk)
    second_page = candidate_property_ids(focus, limit=2, after_id=first_page[-1])

    assert first_page == [uuid.UUID(str(candidates[0].pk)), uuid.UUID(str(candidates[1].pk))]
    assert second_page == [uuid.UUID(str(candidates[2].pk))]


@pytest.mark.django_db
def test_interrupted_backfill_records_safe_failure_and_resumes_same_checkpoint(monkeypatch):
    source = Source.objects.create(
        name="retry-backfill-source",
        domain="retry-backfill.example",
        display_name="منبع تلاش دوباره",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    make_property(source, "RETRY")
    operation_id = uuid.uuid4()
    original_measure = match_operations.measure_indexed_candidate_page

    def fail_with_restricted_detail(*_args, **_kwargs):
        raise RuntimeError("exact location 35.774100,51.356200")

    monkeypatch.setattr(
        match_operations, "measure_indexed_candidate_page", fail_with_restricted_detail
    )
    with pytest.raises(RuntimeError, match="exact location"):
        backfill_property_matching(
            operation_id=str(operation_id),
            limit=1,
            generation=0,
        )

    interrupted = PropertyMatchOperation.objects.get(pk=operation_id)
    assert interrupted.status == "failed"
    assert interrupted.error_code == "RuntimeError"
    assert interrupted.generation == 0
    assert interrupted.cursor is None

    monkeypatch.setattr(match_operations, "measure_indexed_candidate_page", original_measure)
    monkeypatch.setattr(backfill_property_matching, "delay", lambda **_kwargs: None)
    generation = interrupted.generation
    while True:
        result = backfill_property_matching(
            operation_id=str(operation_id),
            limit=1,
            generation=generation,
        )
        if result["status"] == "completed":
            break
        generation = int(result["generation"])

    interrupted.refresh_from_db()
    assert interrupted.status == "completed"
    assert interrupted.error_code == ""
    assert interrupted.processed_targets == 1


@pytest.mark.django_db
def test_duplicate_backfill_delivery_requeues_without_advancing_the_checkpoint(
    django_capture_on_commit_callbacks,
    monkeypatch,
):
    source = Source.objects.create(
        name="duplicate-backfill-source",
        domain="duplicate-backfill.example",
        display_name="منبع تحویل تکراری",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    make_property(source, "FIRST")
    make_property(source, "SECOND")
    delayed: list[dict[str, object]] = []
    monkeypatch.setattr(
        backfill_property_matching,
        "delay",
        lambda **kwargs: delayed.append(kwargs),
    )
    operation_id = uuid.uuid4()

    with django_capture_on_commit_callbacks(execute=True):
        first = backfill_property_matching(
            operation_id=str(operation_id),
            limit=1,
            generation=0,
        )
    assert first["generation"] == 1
    assert len(delayed) == 1
    evaluation_count = sum(
        item.evaluations.count() for item in PropertyMatchSuggestion.objects.all()
    )
    delayed.clear()

    with django_capture_on_commit_callbacks(execute=True):
        duplicate = backfill_property_matching(
            operation_id=str(operation_id),
            limit=1,
            generation=0,
        )

    assert duplicate == first
    assert delayed == [
        {
            "operation_id": str(operation_id),
            "limit": 1,
            "generation": 1,
        }
    ]
    assert sum(item.evaluations.count() for item in PropertyMatchSuggestion.objects.all()) == (
        evaluation_count
    )


@pytest.mark.django_db
def test_retry_after_continuation_publish_failure_requeues_committed_checkpoint(
    django_capture_on_commit_callbacks,
    monkeypatch,
):
    source = Source.objects.create(
        name="publish-failure-source",
        domain="publish-failure.example",
        display_name="منبع خطای ادامه",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    make_property(source, "FIRST")
    make_property(source, "SECOND")
    operation_id = uuid.uuid4()

    def fail_to_publish(**_kwargs):
        raise ConnectionError("broker unavailable")

    monkeypatch.setattr(backfill_property_matching, "delay", fail_to_publish)
    with (
        pytest.raises(ConnectionError, match="broker unavailable"),
        django_capture_on_commit_callbacks(execute=True),
    ):
        backfill_property_matching(
            operation_id=str(operation_id),
            limit=1,
            generation=0,
        )

    operation = PropertyMatchOperation.objects.get(pk=operation_id)
    assert operation.status == "failed"
    assert operation.generation == 1
    evaluation_count = sum(
        item.evaluations.count() for item in PropertyMatchSuggestion.objects.all()
    )
    delayed: list[dict[str, object]] = []
    monkeypatch.setattr(
        backfill_property_matching,
        "delay",
        lambda **kwargs: delayed.append(kwargs),
    )

    with django_capture_on_commit_callbacks(execute=True):
        retry = backfill_property_matching(
            operation_id=str(operation_id),
            limit=1,
            generation=0,
        )

    assert retry["generation"] == 1
    assert delayed == [
        {
            "operation_id": str(operation_id),
            "limit": 1,
            "generation": 1,
        }
    ]
    assert sum(item.evaluations.count() for item in PropertyMatchSuggestion.objects.all()) == (
        evaluation_count
    )


@pytest.mark.django_db
def test_backfill_remains_safe_when_publication_arrives_between_pages(monkeypatch):
    source = Source.objects.create(
        name="publication-backfill-source",
        domain="publication-backfill.example",
        display_name="منبع انتشار همزمان",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    first = make_property(
        source,
        "FIRST",
        property_id="10000000-0000-0000-0000-000000000000",
    )
    second = make_property(
        source,
        "SECOND",
        property_id="20000000-0000-0000-0000-000000000000",
    )
    monkeypatch.setattr(backfill_property_matching, "delay", lambda **_kwargs: None)
    operation_id = uuid.uuid4()
    page = backfill_property_matching(
        operation_id=str(operation_id),
        limit=1,
        generation=0,
    )

    published_during_backfill = make_property(
        source,
        "PUBLISHED-DURING-BACKFILL",
        property_id="30000000-0000-0000-0000-000000000000",
    )
    measure_candidates_for_property(published_during_backfill.pk, limit=25)
    while page["status"] != "completed":
        page = backfill_property_matching(
            operation_id=str(operation_id),
            limit=1,
            generation=int(page["generation"]),
        )

    assert PropertyMatchSuggestion.objects.count() == 3
    assert not PropertyMatchDecision.objects.exists()
    assert first.merged_into_id is None
    assert second.merged_into_id is None
    assert published_during_backfill.merged_into_id is None


@pytest.mark.django_db
def test_rescore_preserves_operator_decision_made_between_pages(
    api_client: APIClient,
    monkeypatch,
):
    source = Source.objects.create(
        name="decision-rescore-source",
        domain="decision-rescore.example",
        display_name="منبع تصمیم همزمان",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    focus = make_property(source, "FOCUS")
    make_property(source, "FIRST")
    make_property(source, "SECOND")
    measure_candidates_for_property(focus.pk, limit=25)
    monkeypatch.setattr(rescore_property_matching, "delay", lambda **_kwargs: None)
    operation_id = uuid.uuid4()
    first_page = rescore_property_matching(
        operation_id=str(operation_id),
        limit=1,
        generation=0,
    )
    untouched = next(
        suggestion
        for suggestion in PropertyMatchSuggestion.objects.all()
        if suggestion.evaluations.count() == 1
    )
    api_client.force_authenticate(make_operator())
    review = claim_suggestion(api_client, untouched)
    response = api_client.post(
        f"/api/v1/operator/catalog-curation/suggestions/{untouched.pk}/reject/",
        review,
        format="json",
    )
    assert response.status_code == 201

    page = first_page
    while page["status"] != "completed":
        page = rescore_property_matching(
            operation_id=str(operation_id),
            limit=1,
            generation=int(page["generation"]),
        )

    untouched.refresh_from_db()
    assert untouched.state == "rejected"
    assert untouched.evaluations.count() == 2
    assert PropertyMatchDecision.objects.filter(pk=response.data["id"]).exists()


@pytest.mark.django_db
def test_management_command_starts_a_repeatable_operation(
    django_capture_on_commit_callbacks,
    monkeypatch,
):
    operation_id = uuid.uuid4()
    delayed: list[dict[str, object]] = []
    monkeypatch.setattr(
        backfill_property_matching,
        "delay",
        lambda **kwargs: delayed.append(kwargs),
    )
    stdout = StringIO()

    with django_capture_on_commit_callbacks(execute=True):
        call_command(
            "run_property_match_operation",
            "backfill",
            operation_id=str(operation_id),
            limit=25,
            stdout=stdout,
        )

    assert delayed == [
        {
            "operation_id": str(operation_id),
            "limit": 25,
            "generation": 0,
        }
    ]
    assert stdout.getvalue().strip() == str(operation_id)


@pytest.mark.django_db(transaction=True)
def test_overlapping_operation_deliveries_are_serialized_by_postgresql(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL row-lock contract")
    source = Source.objects.create(
        name="overlap-operation-source",
        domain="overlap-operation.example",
        display_name="منبع اجرای همپوشان",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    make_property(source, "FIRST")
    make_property(source, "SECOND")
    existing_evaluations = sum(
        item.evaluations.count() for item in PropertyMatchSuggestion.objects.all()
    )
    monkeypatch.setattr(backfill_property_matching, "delay", lambda **_kwargs: None)
    operation_id = uuid.uuid4()
    barrier = Barrier(2)

    def deliver(_index: int) -> dict[str, int | str]:
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return backfill_property_matching(
                operation_id=str(operation_id),
                limit=1,
                generation=0,
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(deliver, range(2)))

    operation = PropertyMatchOperation.objects.get(pk=operation_id)
    assert {result["generation"] for result in results} == {1}
    assert operation.generation == 1
    assert operation.processed_targets == 0
    assert operation.evaluated_pairs == 1
    assert PropertyMatchSuggestion.objects.count() == 1
    assert PropertyMatchSuggestion.objects.get().evaluations.count() == existing_evaluations + 1
