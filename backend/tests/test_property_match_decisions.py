import pytest
from rest_framework.test import APIClient

from apps.catalog.models import OutboundPolicy, Source
from tests.test_catalog_curation import make_current_property, make_operator

BASE = "/api/v1/operator/catalog-curation/"


@pytest.fixture
def comparison_case(api_client):
    operator = make_operator(email="decision@example.com")
    source = Source.objects.create(
        name="decision-source",
        domain="decision.example",
        display_name="منبع",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    left, _ = make_current_property(source=source, source_reference="LEFT")
    right, _ = make_current_property(source=source, source_reference="RIGHT", area_sqm=95)
    api_client.force_authenticate(operator)
    return operator, left, right


def compare(client, left, right):
    response = client.get(BASE + "comparison/", {"property": [str(left.pk), str(right.pk)]})
    assert response.status_code == 200
    return response.data


@pytest.mark.django_db
def test_opening_is_read_only_and_claim_is_exclusive_and_renewable(api_client, comparison_case):
    operator, left, right = comparison_case
    opened = compare(api_client, left, right)
    assert opened["claim"] is None
    property_type = next(
        field for field in opened["decision_fields"] if field["key"] == "property_type"
    )
    assert property_type["display_values"][str(left.pk)] == "آپارتمان"
    body = {"properties": [str(left.pk), str(right.pk)], "revision": opened["revision"]}
    claimed = api_client.post(BASE + "claim/", body, format="json")
    assert claimed.status_code == 200
    renewed = api_client.post(BASE + "claim/", body, format="json")
    assert renewed.status_code == 200
    assert renewed.data["claim"]["id"] == claimed.data["claim"]["id"]
    other = APIClient()
    other.force_authenticate(make_operator(email="other@example.com"))
    inspected = compare(other, left, right)
    assert inspected["claim"]["actor_id"] == str(operator.pk)
    assert other.post(BASE + "claim/", body, format="json").status_code == 409


def approval_body(client, left, right):
    opened = compare(client, left, right)
    claim = client.post(
        BASE + "claim/",
        {
            "properties": [str(left.pk), str(right.pk)],
            "revision": opened["revision"],
        },
        format="json",
    )
    assert claim.status_code == 200
    return {
        "properties": [str(left.pk), str(right.pk)],
        "revision": opened["revision"],
        "claim_id": claim.data["claim"]["id"],
        "survivor_id": str(left.pk),
        "survivor_confirmed": True,
        "fact_choices": {field["key"]: str(left.pk) for field in opened["decision_fields"]},
        "image_ids": [],
        "images_confirmed": True,
        "warning_confirmed": True,
    }


@pytest.mark.django_db
def test_approval_moves_listings_favorites_and_exposes_audited_idempotent_decision(
    api_client,
    comparison_case,
):
    from apps.catalog.models import Favorite

    operator, left, right = comparison_case
    Favorite.objects.create(account=operator, property=left)
    Favorite.objects.create(account=operator, property=right)
    before = compare(api_client, left, right)
    body = approval_body(api_client, left, right)
    approved = api_client.post(BASE + "approve/", body, format="json")
    assert approved.status_code == 201, approved.data
    audit = api_client.get(BASE + f"decisions/{approved.data['id']}/")
    assert audit.status_code == 200
    assert audit.data["actor_id"] == str(operator.pk)
    assert audit.data["origin"] == "operator_initiated"
    assert audit.data["before_revision"] == before["revision"]
    assert audit.data["after_revision"] != before["revision"]
    assert len(audit.data["affected_listing_ids"]) == 2
    assert len(audit.data["grouping_event_ids"]) == 1
    retried = api_client.post(BASE + "approve/", body, format="json")
    assert retried.status_code == 200
    assert retried.data["id"] == approved.data["id"]
    survivor = api_client.get(f"/api/v1/catalog/properties/{left.pk}/")
    alias = api_client.get(f"/api/v1/catalog/properties/{right.pk}/")
    assert survivor.status_code == alias.status_code == 200
    assert alias.data["id"] == survivor.data["id"] == str(left.pk)
    assert len(survivor.data["listings"]) == 2
    favorites = api_client.get("/api/v1/catalog/favorites/")
    assert favorites.status_code == 200
    assert len(favorites.data["active"]) == 1


@pytest.mark.django_db
def test_selected_images_preserve_redundant_history_and_listing_images(api_client, comparison_case):
    from django.utils import timezone

    from apps.catalog.models import PropertyImage, PropertyImageVariant
    from tests.test_catalog_curation import attach_listing_image, image_fixture

    operator, left, right = comparison_case
    images = []
    for property_ in (left, right):
        listing_image = attach_listing_image(property_.listings.get(), image_fixture(), position=0)
        image = PropertyImage.objects.create(
            property=property_,
            position=0,
            is_primary=True,
            reviewed_at=timezone.now(),
            reviewed_by=operator,
        )
        variant = listing_image.variants.get()
        PropertyImageVariant.objects.create(image=image, kind=variant.kind, asset=variant.asset)
        images.append(image)
    body = approval_body(api_client, left, right)
    body["image_ids"] = [str(images[1].pk)]
    body["fact_choices"]["area_sqm"] = str(right.pk)
    approved = api_client.post(BASE + "approve/", body, format="json")
    assert approved.status_code == 201, approved.data
    audit = api_client.get(BASE + f"decisions/{approved.data['id']}/").data
    assert audit["selected_facts"]["area_sqm"] == 95
    assert len(audit["evidence"]["property_images"]) == 2
    assert len(audit["after_snapshot"]["property_images"]) == 3
    assert audit["evidence"]["listing_images"] == audit["after_snapshot"]["listing_images"]
    assert audit["evidence"]["listing_variants"] == audit["after_snapshot"]["listing_variants"]
    old_right = next(
        row for row in audit["after_snapshot"]["properties"] if row["id"] == str(right.pk)
    )
    assert old_right["area_sqm"] == 95
    assert old_right["merged_into_id"] == str(left.pk)
    public = api_client.get(f"/api/v1/catalog/properties/{left.pk}/").data
    assert len(public["images"]) == 1
    assert api_client.get(BASE + f"images/{images[0].pk}/").status_code == 200


@pytest.mark.django_db
@pytest.mark.parametrize("change", ["facts", "listing", "images", "grouping"])
def test_changed_evidence_requires_refresh(api_client, comparison_case, change):
    from apps.catalog.services import merge_properties
    from tests.test_catalog_curation import attach_listing_image, image_fixture

    _, left, right = comparison_case
    body = approval_body(api_client, left, right)
    if change == "facts":
        right.area_sqm = 101
        right.save(update_fields=["area_sqm"])
    elif change == "listing":
        listing = right.listings.get()
        listing.source_claims = {"address": "new evidence"}
        listing.save(update_fields=["source_claims"])
    elif change == "images":
        attach_listing_image(right.listings.get(), image_fixture(), position=0)
    else:
        merge_properties(target=right, duplicate=left)
    rejected = api_client.post(BASE + "approve/", body, format="json")
    assert rejected.status_code == 409


@pytest.mark.django_db
@pytest.mark.parametrize(
    "missing", ["survivor_confirmed", "images_confirmed", "fact_choices", "warning_confirmed"]
)
def test_decision_requires_explicit_choices_and_warning_confirmation(
    api_client, comparison_case, missing
):
    _, left, right = comparison_case
    right.latitude = None
    right.longitude = None
    right.area_sqm = 1000
    right.save()
    body = approval_body(api_client, left, right)
    body[missing] = {} if missing == "fact_choices" else False
    rejected = api_client.post(BASE + "approve/", body, format="json")
    assert rejected.status_code == 400
    assert compare(api_client, left, right)["revision"] == body["revision"]


@pytest.mark.django_db
def test_own_direct_listing_and_unprivileged_actors_cannot_decide(api_client, comparison_case):
    from apps.submissions.models import Submission

    operator, left, right = comparison_case
    body = approval_body(api_client, left, right)
    listing = right.listings.get()
    listing.source.outbound_policy = OutboundPolicy.DIRECT_CONTACT
    listing.source.save()
    Submission.objects.create(submitter=operator, role="owner", listing=listing)
    assert api_client.post(BASE + "approve/", body, format="json").status_code == 403
    assert (
        api_client.post(
            BASE + "claim/",
            {"properties": body["properties"], "revision": body["revision"]},
            format="json",
        ).status_code
        == 403
    )
    api_client.force_authenticate(make_operator(email="ordinary@example.com", capability=None))
    assert api_client.post(BASE + "approve/", body, format="json").status_code == 403


@pytest.mark.django_db
def test_expired_claim_requires_reclaim_and_other_operator_cannot_approve(
    api_client, comparison_case
):
    from django.utils import timezone

    from apps.catalog.models import PropertyMatchClaim

    _, left, right = comparison_case
    body = approval_body(api_client, left, right)
    other = APIClient()
    other.force_authenticate(make_operator(email="different@example.com"))
    assert other.post(BASE + "approve/", body, format="json").status_code == 409
    PropertyMatchClaim.objects.update(expires_at=timezone.now() - timezone.timedelta(seconds=1))
    assert api_client.post(BASE + "approve/", body, format="json").status_code == 409
    claim = other.post(
        BASE + "claim/",
        {"properties": body["properties"], "revision": body["revision"]},
        format="json",
    )
    assert claim.status_code == 200


def postgres_only():
    from django.db import connection

    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL row-lock contract")


@pytest.mark.django_db(transaction=True)
def test_concurrent_reversed_claims_have_one_winner(api_client, comparison_case):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections

    _, left, right = comparison_case
    postgres_only()
    actors = [make_operator(email=f"claim-{i}@example.com") for i in range(2)]
    pairs = [(left, right), (right, left)]
    revisions = [compare(api_client, *pair)["revision"] for pair in pairs]
    barrier = Barrier(2)

    def claim(i):
        close_old_connections()
        client = APIClient()
        client.force_authenticate(actors[i])
        try:
            barrier.wait(timeout=10)
            return client.post(
                BASE + "claim/",
                {"properties": [str(p.pk) for p in pairs[i]], "revision": revisions[i]},
                format="json",
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, range(2)))
    assert sorted(results) == [200, 409]


@pytest.mark.django_db(transaction=True)
def test_duplicate_approvals_are_safe_under_concurrency(api_client, comparison_case):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections

    from apps.catalog.match_decisions import approve_comparison
    from apps.catalog.operator_serializers import PropertyMatchApproveRequestSerializer

    operator, left, right = comparison_case
    postgres_only()
    body = approval_body(api_client, left, right)
    serializer = PropertyMatchApproveRequestSerializer(data=body)
    serializer.is_valid(raise_exception=True)
    barrier = Barrier(2)

    def approve(_):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return approve_comparison(actor=operator, **serializer.validated_data).pk
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        decisions = list(pool.map(approve, range(2)))
    assert decisions[0] == decisions[1]
    audit = api_client.get(BASE + f"decisions/{decisions[0]}/").data
    assert len(audit["grouping_event_ids"]) == 1


@pytest.mark.django_db(transaction=True)
def test_connected_approvals_lock_all_roots_stably_and_leave_no_partial_merge():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections
    from django.db.models import Count
    from django.utils import timezone

    from apps.catalog.match_decisions import (
        FACT_FIELDS,
        ReviewConflict,
        approve_comparison,
        comparison_data,
    )
    from apps.catalog.match_suggestions import evaluate_property_pair
    from apps.catalog.models import (
        Listing,
        Property,
        PropertyMatchClaim,
        PropertyMatchDecision,
    )

    postgres_only()
    source = Source.objects.create(
        name="connected-concurrency-source",
        domain="connected-concurrency.example",
        display_name="منبع همزمان",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    property_a, _ = make_current_property(source=source, source_reference="A")
    property_b, _ = make_current_property(source=source, source_reference="B")
    property_c, _ = make_current_property(source=source, source_reference="C")
    suggestion_ab = evaluate_property_pair(property_a.pk, property_b.pk, origin="focused")
    suggestion_bc = evaluate_property_pair(property_b.pk, property_c.pk, origin="focused")
    assert suggestion_ab is not None
    assert suggestion_bc is not None
    operator = make_operator(email="connected-concurrency@example.com")
    cases = []
    for left, right, suggestion in (
        (property_a, property_b, suggestion_ab),
        (property_b, property_c, suggestion_bc),
    ):
        comparison = comparison_data([left.pk, right.pk])
        ordered_ids = sorted((left.pk, right.pk))
        claim = PropertyMatchClaim.objects.create(
            left_id=ordered_ids[0],
            right_id=ordered_ids[1],
            actor=operator,
            suggestion=suggestion,
            expires_at=timezone.now() + timezone.timedelta(minutes=10),
        )
        cases.append({
            "actor": operator,
            "properties": [left.pk, right.pk],
            "revision": comparison["revision"],
            "claim_id": claim.pk,
            "survivor_id": left.pk,
            "survivor_confirmed": True,
            "fact_choices": {field: left.pk for field in FACT_FIELDS},
            "image_ids": [],
            "images_confirmed": True,
            "warning_confirmed": True,
            "suggestion_id": suggestion.pk,
        })
    barrier = Barrier(2)

    def approve(index: int) -> str:
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            try:
                approve_comparison(**cases[index])
            except ReviewConflict:
                return "conflict"
            return "approved"
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(approve, range(2)))

    assert sorted(results) == ["approved", "conflict"]
    assert PropertyMatchDecision.objects.filter(outcome="same_property").count() == 1
    assert Property.objects.filter(merged_into__isnull=True).count() == 2
    assert sorted(
        Listing.objects
        .filter(property__merged_into__isnull=True)
        .values("property_id")
        .annotate(count=Count("id"))
        .values_list("count", flat=True)
    ) == [1, 2]


@pytest.mark.django_db(transaction=True)
def test_favorite_save_racing_grouping_follows_survivor(api_client, comparison_case):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections

    from apps.catalog.models import Favorite

    operator, left, right = comparison_case
    postgres_only()
    Favorite.objects.create(account=operator, property=left)
    body = approval_body(api_client, left, right)
    barrier = Barrier(2)

    def action(index):
        close_old_connections()
        client = APIClient()
        client.force_authenticate(operator)
        try:
            barrier.wait(timeout=10)
            if index == 0:
                return client.post(BASE + "approve/", body, format="json").status_code
            return client.put(f"/api/v1/catalog/properties/{right.pk}/favorite/").status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(action, range(2)))
    assert results == [201, 204]
    favorites = api_client.get("/api/v1/catalog/favorites/").data
    assert len(favorites["active"]) == 1
    assert favorites["active"][0]["id"] == str(left.pk)


@pytest.mark.django_db(transaction=True)
def test_database_failure_rolls_back_facts_images_favorites_and_decision(
    api_client, comparison_case
):
    from django.db import ProgrammingError, connection

    from apps.catalog.models import Favorite

    operator, left, right = comparison_case
    postgres_only()
    Favorite.objects.create(account=operator, property=right)
    body = approval_body(api_client, left, right)
    body["fact_choices"]["area_sqm"] = str(right.pk)
    with connection.cursor() as cursor:
        cursor.execute(
            "CREATE FUNCTION pg_temp.reject_grouping() RETURNS trigger LANGUAGE plpgsql AS $$ "
            "BEGIN RAISE EXCEPTION 'test storage failure'; END $$"
        )
        cursor.execute(
            "CREATE TRIGGER test_reject_grouping BEFORE INSERT ON catalog_listinggroupingevent "
            "FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_grouping()"
        )
    try:
        with pytest.raises(ProgrammingError, match="test storage failure"):
            api_client.post(BASE + "approve/", body, format="json")
    finally:
        with connection.cursor() as cursor:
            cursor.execute("DROP TRIGGER test_reject_grouping ON catalog_listinggroupingevent")
    assert compare(api_client, left, right)["revision"] == body["revision"]
    favorites = api_client.get("/api/v1/catalog/favorites/").data
    assert favorites["active"][0]["id"] == str(right.pk)
    assert api_client.post(BASE + "approve/", body, format="json").status_code == 201


@pytest.mark.django_db(transaction=True)
def test_favorite_alias_retry_releases_old_root_before_stale_comparison(
    api_client,
    comparison_case,
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from django.db import close_old_connections, connection, transaction

    from apps.catalog.match_decisions import ReviewConflict, comparison_data
    from apps.catalog.models import Property
    from apps.catalog.services import save_favorite

    operator, first, second = comparison_case
    postgres_only()
    survivor, redundant = sorted((first, second), key=lambda item: item.pk)
    body = approval_body(api_client, survivor, redundant)
    approaching_old_root = Event()
    merge_committed = Event()
    old_root_locked = Event()
    survivor_locked = Event()

    def save():
        close_old_connections()
        intercepted = False

        def interleave(execute, sql, params, many, context):
            nonlocal intercepted
            if "FOR UPDATE" not in sql or intercepted:
                return execute(sql, params, many, context)
            intercepted = True
            approaching_old_root.set()
            assert merge_committed.wait(10)
            result = execute(sql, params, many, context)
            old_root_locked.set()
            assert survivor_locked.wait(10)
            return result

        try:
            with connection.cursor() as cursor:
                cursor.execute("SET lock_timeout = '4s'")
            with connection.execute_wrapper(interleave):
                save_favorite(account_id=operator.pk, property_id=redundant.pk)
        finally:
            close_old_connections()

    def stale_comparison():
        close_old_connections()
        try:
            assert old_root_locked.wait(10)
            with transaction.atomic():
                Property.objects.select_for_update().get(pk=survivor.pk)
                survivor_locked.set()
                with pytest.raises(ReviewConflict):
                    comparison_data([survivor.pk, redundant.pk])
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        saving = pool.submit(save)
        stale = pool.submit(stale_comparison)
        assert approaching_old_root.wait(10)
        try:
            assert api_client.post(BASE + "approve/", body, format="json").status_code == 201
        finally:
            merge_committed.set()
        saving.result(timeout=15)
        stale.result(timeout=15)
    favorites = api_client.get("/api/v1/catalog/favorites/").data
    assert [item["id"] for item in favorites["active"]] == [str(survivor.pk)]
