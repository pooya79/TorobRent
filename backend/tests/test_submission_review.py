from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from django.contrib.auth.models import Permission
from django.core.exceptions import ValidationError
from django.db import close_old_connections, connection
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import (
    TEHRAN_CITY_ID,
    City,
    District,
    Listing,
    ListingState,
    Neighborhood,
    OutboundPolicy,
    Property,
    Source,
)
from apps.submissions.models import (
    ReviewClaim,
    Submission,
    SubmissionEvent,
    SubmissionImage,
    SubmissionImageStatus,
    SubmissionState,
)
from apps.submissions.services import (
    ReviewWorkflowConflict,
    approve_submission,
    claim_submission_review,
    reject_submission,
    release_submission_review_claim,
    release_unavailable_review_claims,
    request_submission_changes,
    submit_for_review,
)


def review_permission() -> Permission:
    return Permission.objects.get(
        content_type__app_label="submissions",
        codename="review_submission",
    )


def make_operator(*, email: str = "operator@example.com", permitted: bool = True) -> User:
    operator = User.objects.create_user(
        email=email,
        password="password",
        email_verified_at=timezone.now(),
    )
    if permitted:
        operator.user_permissions.add(review_permission())
    return operator


def make_complete_submission(
    *,
    email: str = "submitter@example.com",
    property_type: str = "apartment",
    room_count: int | None = 2,
) -> Submission:
    submitter = User.objects.create_user(
        email=email,
        password="password",
        email_verified_at=timezone.now(),
    )
    city, _ = City.objects.get_or_create(
        id=TEHRAN_CITY_ID,
        defaults={
            "name_fa": "تهران",
            "source_code": "city-tehran",
            "source_year": 1403,
            "provenance_url": "https://example.com/city",
            "imported_at": timezone.localdate(),
            "reviewed": True,
        },
    )
    district, _ = District.objects.get_or_create(
        city=city,
        number=2,
        defaults={
            "name_fa": "منطقه ۲",
            "source_code": "district-2",
            "source_year": 1403,
            "provenance_url": "https://example.com/district",
            "imported_at": timezone.localdate(),
            "reviewed": True,
        },
    )
    neighborhood, _ = Neighborhood.objects.get_or_create(
        district=district,
        name_fa="سعادت‌آباد",
        defaults={
            "source_code": "neighborhood-saadat-abad",
            "source_year": 1403,
            "provenance_url": "https://example.com/neighborhood",
            "imported_at": timezone.localdate(),
            "reviewed": True,
        },
    )
    source, _ = Source.objects.get_or_create(
        is_builtin=True,
        defaults={
            "name": "torobrent-direct",
            "domain": "direct.torobrent.test",
            "display_name": "TorobRent",
            "outbound_policy": OutboundPolicy.DIRECT_CONTACT,
        },
    )
    submission = Submission.objects.create(
        submitter=submitter,
        role="owner",
        source=source,
        city=city,
        district=district,
        neighborhood=neighborhood,
        address="بلوار دریا، کوچه سرو",
        property_type=property_type,
        area_sqm=110,
        room_count=room_count,
        deposit_rial=10_000_000_000,
        monthly_rent_rial=250_000_000,
        parking="present",
        description="نورگیر و آرام",
        contact_name="سارا احمدی",
        contact_phone="۰۹۱۲۱۲۳۴۵۶۷",
        authorization_declared=True,
        phone_publication_consent=True,
        review_data={"accuracy_confirmed": True},
        media_complete=True,
        current_step="review",
    )
    SubmissionImage.objects.create(
        submission=submission,
        status=SubmissionImageStatus.READY,
        position=0,
        is_primary=True,
    )
    return submission


@pytest.mark.django_db
def test_complete_submission_enters_review_once_and_records_the_transition(api_client: APIClient):
    submission = make_complete_submission()
    submission.monthly_rent_rial = 0
    submission.save(update_fields=("monthly_rent_rial", "updated_at"))
    api_client.force_authenticate(submission.submitter)
    url = f"/api/v1/submissions/{submission.id}/submit/"

    submitted = api_client.post(url, {}, format="json")
    repeated = api_client.post(url, {}, format="json")

    assert submitted.status_code == 200
    assert submitted.data["state"] == "pending"
    assert repeated.status_code == 400
    assert SubmissionEvent.objects.filter(submission=submission).values(
        "actor_id", "prior_state", "new_state", "reason", "revision"
    ).get() == {
        "actor_id": submission.submitter_id,
        "prior_state": "draft",
        "new_state": "pending",
        "reason": "",
        "revision": 1,
    }


@pytest.mark.django_db
def test_operator_requests_changes_with_reason_and_submitter_resubmits(api_client: APIClient):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    api_client.force_authenticate(operator)
    assert (
        api_client.post(
            f"/api/v1/operator/submissions/{submission.id}/claim/", {}, format="json"
        ).status_code
        == 201
    )

    missing_reason = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/request-changes/",
        {"reason": "", "reviewed_revision": submission.revision},
        format="json",
    )
    requested = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/request-changes/",
        {
            "reason": "شماره تماس را اصلاح کنید.",
            "reviewed_revision": submission.revision,
        },
        format="json",
    )

    assert missing_reason.status_code == 400
    assert requested.status_code == 200
    assert requested.data["state"] == "changes_requested"
    api_client.force_authenticate(submission.submitter)
    edited = api_client.patch(
        f"/api/v1/submissions/{submission.id}/",
        {
            "completed_step": "contact",
            "contact": {
                "name": "سارا احمدی",
                "phone": "۰۹۱۲۰۰۰۰۰۰۰",
                "authorization_declared": True,
                "phone_publication_consent": True,
            },
        },
        format="json",
    )
    assert edited.status_code == 200
    assert edited.data["state"] == "draft"
    assert edited.data["revision"] == 2
    assert edited.data["review"] == {}
    reviewed = api_client.patch(
        f"/api/v1/submissions/{submission.id}/",
        {"completed_step": "review", "review": {"accuracy_confirmed": True}},
        format="json",
    )
    assert reviewed.status_code == 200
    resubmitted = api_client.post(f"/api/v1/submissions/{submission.id}/submit/", {}, format="json")
    assert resubmitted.status_code == 200
    assert resubmitted.data["state"] == "pending"
    assert [event["new_state"] for event in resubmitted.data["history"]] == [
        "pending",
        "changes_requested",
        "draft",
        "pending",
    ]
    assert resubmitted.data["available_actions"] == []


@pytest.mark.django_db
def test_operator_rejects_terminally_and_review_permission_is_required(api_client: APIClient):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    unpermitted = make_operator(email="unpermitted@example.com", permitted=False)
    api_client.force_authenticate(unpermitted)
    url = f"/api/v1/operator/submissions/{submission.id}/reject/"

    denied = api_client.post(
        url,
        {"reason": "محتوای ممنوع", "reviewed_revision": submission.revision},
        format="json",
    )
    api_client.force_authenticate(submission.submitter)
    submitter_approval = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/approve/",
        {"reviewed_revision": submission.revision},
        format="json",
    )
    operator = make_operator()
    api_client.force_authenticate(operator)
    assert (
        api_client.post(
            f"/api/v1/operator/submissions/{submission.id}/claim/", {}, format="json"
        ).status_code
        == 201
    )
    rejected = api_client.post(
        url,
        {"reason": "محتوای ممنوع", "reviewed_revision": submission.revision},
        format="json",
    )
    api_client.force_authenticate(submission.submitter)
    edit = api_client.patch(
        f"/api/v1/submissions/{submission.id}/",
        {"completed_step": "features_description", "features": {}},
        format="json",
    )

    assert denied.status_code == 403
    assert submitter_approval.status_code == 403
    assert rejected.status_code == 200
    assert rejected.data["state"] == "rejected"
    assert rejected.data["history"][-1]["reason"] == "محتوای ممنوع"
    assert edit.status_code == 400


@pytest.mark.django_db
def test_approval_creates_and_publishes_a_normalized_direct_listing(api_client: APIClient):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    api_client.force_authenticate(operator)
    assert (
        api_client.post(
            f"/api/v1/operator/submissions/{submission.id}/claim/", {}, format="json"
        ).status_code
        == 201
    )

    approved = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/approve/",
        {
            "reviewed_revision": submission.revision,
            "normalized_property": {
                "area_sqm": 112,
                "parking": "present",
                "operator_location_notes": "نشانی یکدست شد",
            },
            "source_metadata": {
                "source_reference": "direct-12",
                "provenance_note": "بازبینی تلفنی",
            },
            "formatting": {"description": "نورگیر و آرام."},
        },
        format="json",
    )

    assert approved.status_code == 200, approved.data
    listing = Listing.objects.select_related("property", "terms", "source").get(
        submission=submission
    )
    assert listing.state == ListingState.PUBLISHED
    assert listing.property.area_sqm == 112
    assert listing.source.is_builtin is True
    assert listing.source_reference == "direct-12"
    assert listing.description == "نورگیر و آرام."
    assert listing.direct_phone == submission.contact_phone
    assert approved.data["listing_id"] == str(listing.id)


@pytest.mark.django_db
def test_office_without_rooms_travels_from_submission_through_operator_publication(
    api_client: APIClient,
):
    submission = make_complete_submission(property_type="office", room_count=None)
    api_client.force_authenticate(submission.submitter)

    draft = api_client.get(f"/api/v1/submissions/{submission.id}/")
    submitted = api_client.post(f"/api/v1/submissions/{submission.id}/submit/", {}, format="json")

    assert draft.status_code == 200
    assert draft.data["property_facts"]["property_category"] == "commercial"
    assert draft.data["property_facts"]["property_category_label"] == "تجاری"
    assert draft.data["property_facts"]["property_type"] == "office"
    assert draft.data["property_facts"]["property_type_label"] == "دفتر اداری"
    assert draft.data["property_facts"]["room_count"] is None
    assert submitted.status_code == 200, submitted.data

    operator = make_operator()
    api_client.force_authenticate(operator)
    claimed = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/claim/", {}, format="json"
    )
    approved = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/approve/",
        {"reviewed_revision": submission.revision},
        format="json",
    )

    assert claimed.status_code == 201
    assert approved.status_code == 200, approved.data
    property_ = Property.objects.get(id=approved.data["property_id"])
    assert property_.property_type == "office"
    assert property_.room_count is None
    assert property_.property_category == "commercial"
    assert property_.listings.get().state == ListingState.PUBLISHED


@pytest.mark.django_db
def test_approval_records_the_reviewed_claim_corrections_and_publication_result(
    api_client: APIClient,
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    api_client.force_authenticate(operator)
    claimed = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/claim/", {}, format="json"
    )

    approved = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/approve/",
        {
            "reviewed_revision": submission.revision,
            "internal_note": "مدارک منبع بررسی شد.",
            "normalized_property": {"area_sqm": 112},
            "source_metadata": {"provenance_note": "بازبینی تلفنی"},
            "formatting": {"description": "نورگیر و آرام."},
        },
        format="json",
    )

    assert approved.status_code == 200, approved.data
    event = approved.data["history"][-1]
    assert event["actor_email"] == operator.email
    assert event["prior_state"] == SubmissionState.PENDING
    assert event["new_state"] == SubmissionState.PUBLISHED
    assert event["reviewed_revision"] == submission.revision
    assert event["review_claim_id"] == claimed.data["claim"]["id"]
    assert event["reason"] == "مدارک منبع بررسی شد."
    assert event["normalized_corrections"] == {
        "property": {"area_sqm": 112},
        "source_metadata": {"provenance_note": "بازبینی تلفنی"},
        "formatting": {"description": "نورگیر و آرام."},
    }
    assert event["publication_result"] == {
        "listing_id": approved.data["listing_id"],
        "property_id": approved.data["property_id"],
        "state": ListingState.PUBLISHED,
        "published_at": event["publication_result"]["published_at"],
        "available_until": event["publication_result"]["available_until"],
    }
    assert event["publication_result"]["published_at"]
    assert event["publication_result"]["available_until"]


@pytest.mark.django_db
def test_break_glass_correction_appends_history_without_changing_the_decision(
    api_client: APIClient,
):
    from apps.submissions.services import append_submission_decision_correction

    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)
    approve_submission(
        submission=submission,
        actor=operator,
        reviewed_revision=submission.revision,
        internal_note="مدارک بررسی شد.",
    )
    decision = SubmissionEvent.objects.get(
        submission=submission,
        new_state=SubmissionState.PUBLISHED,
    )
    original = {
        "actor_id": decision.actor_id,
        "reason": decision.reason,
        "revision": decision.revision,
        "prior_state": decision.prior_state,
        "new_state": decision.new_state,
    }
    administrator = User.objects.create_superuser(
        email="administrator@example.com", password="password"
    )

    with pytest.raises(ValidationError, match="unsupported"):
        append_submission_decision_correction(
            original_event=decision,
            actor=administrator,
            reason="رکورد نامعتبر",
            correction={"publication_result": {"actor_id": str(operator.id)}},
        )
    for invalid_correction in (
        {"publication_result": {"published_at": 123}},
        {"normalized_corrections": {"property": {"area_sqm": "invalid"}}},
    ):
        with pytest.raises(ValidationError, match="unsupported"):
            append_submission_decision_correction(
                original_event=decision,
                actor=administrator,
                reason="مقدار نامعتبر",
                correction=invalid_correction,
            )
    correction = append_submission_decision_correction(
        original_event=decision,
        actor=administrator,
        reason="یادداشت داخلی نادرست بود.",
        correction={"internal_note": "مدارک منبع بررسی شد."},
    )

    decision.refresh_from_db()
    assert {
        "actor_id": decision.actor_id,
        "reason": decision.reason,
        "revision": decision.revision,
        "prior_state": decision.prior_state,
        "new_state": decision.new_state,
    } == original
    assert correction.submission == submission
    assert correction.event_type == "decision_correction"
    assert correction.corrects == decision
    assert correction.actor == administrator
    assert correction.revision == decision.revision
    assert correction.prior_state == decision.prior_state
    assert correction.new_state == decision.new_state
    assert correction.reason == "یادداشت داخلی نادرست بود."
    assert correction.correction == {"internal_note": "مدارک منبع بررسی شد."}
    assert SubmissionEvent.objects.filter(submission=submission).count() == 3
    api_client.force_authenticate(operator)
    history = api_client.get(f"/api/v1/operator/submissions/{submission.id}/").data["history"]
    assert history[-1]["event_type"] == "decision_correction"
    assert history[-1]["corrects_id"] == str(decision.id)
    assert history[-1]["correction"] == {"internal_note": "مدارک منبع بررسی شد."}


@pytest.mark.django_db
def test_submission_decision_history_rejects_updates_and_deletion():
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)
    reject_submission(
        submission=submission,
        actor=operator,
        reviewed_revision=submission.revision,
        reason="رد نهایی",
    )
    decision = SubmissionEvent.objects.get(
        submission=submission,
        new_state=SubmissionState.REJECTED,
    )

    decision.reason = "بازنویسی تاریخچه"
    with pytest.raises(ValidationError, match="immutable"):
        decision.save()
    with pytest.raises(ValidationError, match="immutable"):
        SubmissionEvent.objects.filter(id=decision.id).update(reason="بازنویسی")
    with pytest.raises(ValidationError, match="immutable"):
        decision.delete()
    with pytest.raises(ValidationError, match="immutable"):
        SubmissionEvent.objects.filter(id=decision.id).delete()
    conflicting_copy = SubmissionEvent(
        id=decision.id,
        submission=decision.submission,
        actor=decision.actor,
        revision=decision.revision,
        prior_state=decision.prior_state,
        new_state=decision.new_state,
        reason="بازنویسی با bulk_create",
    )
    with pytest.raises(ValidationError, match="immutable"):
        SubmissionEvent.objects.bulk_create(
            [conflicting_copy],
            update_conflicts=True,
            update_fields=("reason",),
            unique_fields=("id",),
        )
    with pytest.raises(ProtectedError):
        submission.delete()


@pytest.mark.django_db
@pytest.mark.parametrize("decision", [request_submission_changes, reject_submission])
def test_reasoned_decisions_reject_a_blank_reason_at_the_domain_boundary(decision: object):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)

    with pytest.raises(ValidationError, match="reason"):
        decision(
            submission=submission,
            actor=operator,
            reviewed_revision=submission.revision,
            reason="   ",
        )

    submission.refresh_from_db()
    assert submission.state == SubmissionState.PENDING
    assert SubmissionEvent.objects.filter(submission=submission).count() == 1


@pytest.mark.django_db
@pytest.mark.parametrize(
    "substantive_change",
    [
        {"rental_terms": {"deposit_rial": 1}},
        {"authorization_declared": False},
        {"images": []},
        {"normalized_property": {"deposit_rial": 1}},
        {"source_metadata": {"ownership_assertion": "تأییدشده"}},
        {"formatting": {"description": "توضیحات متفاوت و ماهوی"}},
    ],
)
def test_approval_rejects_substantive_changes_for_the_request_changes_path(
    api_client: APIClient,
    substantive_change: dict[str, object],
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    api_client.force_authenticate(operator)
    assert (
        api_client.post(
            f"/api/v1/operator/submissions/{submission.id}/claim/", {}, format="json"
        ).status_code
        == 201
    )

    response = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/approve/",
        {"reviewed_revision": submission.revision, **substantive_change},
        format="json",
    )

    assert response.status_code == 400
    submission.refresh_from_db()
    assert submission.state == SubmissionState.PENDING
    assert submission.listing_id is None


@pytest.mark.django_db
def test_approval_can_group_with_existing_property_and_new_revision_stays_private(
    api_client: APIClient,
):
    submission = make_complete_submission()
    existing = Property.objects.create(
        city=submission.city,
        district=submission.district,
        neighborhood=submission.neighborhood,
        property_type="apartment",
        area_sqm=110,
        room_count=2,
    )
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    api_client.force_authenticate(operator)
    assert (
        api_client.post(
            f"/api/v1/operator/submissions/{submission.id}/claim/", {}, format="json"
        ).status_code
        == 201
    )
    approved = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/approve/",
        {"property_id": str(existing.id), "reviewed_revision": submission.revision},
        format="json",
    )
    listing = Listing.objects.get(id=approved.data["listing_id"])
    original_description = listing.description

    api_client.force_authenticate(submission.submitter)
    revision = api_client.patch(
        f"/api/v1/submissions/{submission.id}/",
        {
            "completed_step": "features_description",
            "features": {
                "parking": "present",
                "elevator": "unknown",
                "storage": "unknown",
                "balcony": "unknown",
                "furnished": "unknown",
            },
            "description": "متن تأییدنشده",
        },
        format="json",
    )

    assert approved.status_code == 200
    assert listing.property_id == existing.id
    assert revision.status_code == 200
    assert revision.data["state"] == "draft"
    listing.refresh_from_db()
    assert listing.state == ListingState.PUBLISHED
    assert listing.description == original_description


@pytest.mark.django_db
def test_operator_queue_filters_state_source_location_and_freshness(api_client: APIClient):
    pending = make_complete_submission(email="pending@example.com")
    submit_for_review(submission=pending, actor=pending.submitter)
    other = make_complete_submission(email="draft@example.com")
    api_client.force_authenticate(make_operator())

    response = api_client.get(
        "/api/v1/operator/submissions/",
        {
            "state": SubmissionState.PENDING,
            "source": str(pending.source_id),
            "city": str(pending.city_id),
            "pending_after": (timezone.now() - timezone.timedelta(minutes=5)).isoformat(),
            "ordering": "oldest",
        },
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.data["results"]] == [str(pending.id)]
    assert str(other.id) not in {item["id"] for item in response.data["results"]}


@pytest.mark.django_db
def test_operator_queue_is_paginated_and_uses_the_current_pending_period(api_client: APIClient):
    older = make_complete_submission(email="older@example.com")
    newer = make_complete_submission(email="newer@example.com")
    submit_for_review(submission=older, actor=older.submitter)
    submit_for_review(submission=newer, actor=newer.submitter)
    Submission.objects.filter(id=older.id).update(
        pending_since=timezone.now() - timezone.timedelta(days=2),
        updated_at=timezone.now(),
    )
    Submission.objects.filter(id=newer.id).update(
        pending_since=timezone.now() - timezone.timedelta(days=1),
        updated_at=timezone.now() - timezone.timedelta(days=3),
    )
    Submission.objects.bulk_create([
        Submission(
            submitter=older.submitter,
            role="owner",
            state=SubmissionState.PENDING,
            pending_since=timezone.now() + timezone.timedelta(minutes=index),
        )
        for index in range(101)
    ])
    api_client.force_authenticate(make_operator())

    default_page = api_client.get("/api/v1/operator/submissions/")
    capped_page = api_client.get("/api/v1/operator/submissions/", {"page_size": 500})

    assert default_page.status_code == 200
    assert default_page.data["count"] == 103
    assert len(default_page.data["results"]) == 50
    assert capped_page.status_code == 200
    assert len(capped_page.data["results"]) == 100
    assert [item["id"] for item in capped_page.data["results"][:2]] == [
        str(older.id),
        str(newer.id),
    ]


@pytest.mark.django_db
def test_resubmission_starts_a_new_pending_period_and_keeps_history(api_client: APIClient):
    submission = make_complete_submission()
    first_pending = submit_for_review(
        submission=submission, actor=submission.submitter
    ).pending_since
    operator = make_operator()
    claim_url = f"/api/v1/operator/submissions/{submission.id}/claim/"
    api_client.force_authenticate(operator)
    assert api_client.post(claim_url, {}, format="json").status_code == 201
    assert (
        api_client.post(
            f"/api/v1/operator/submissions/{submission.id}/request-changes/",
            {"reason": "اصلاح شود", "reviewed_revision": submission.revision},
            format="json",
        ).status_code
        == 200
    )
    api_client.force_authenticate(submission.submitter)
    assert (
        api_client.patch(
            f"/api/v1/submissions/{submission.id}/",
            {
                "completed_step": "contact",
                "contact": {
                    "name": submission.contact_name,
                    "phone": submission.contact_phone,
                    "authorization_declared": True,
                    "phone_publication_consent": True,
                },
            },
            format="json",
        ).status_code
        == 200
    )
    assert (
        api_client.patch(
            f"/api/v1/submissions/{submission.id}/",
            {"completed_step": "review", "review": {"accuracy_confirmed": True}},
            format="json",
        ).status_code
        == 200
    )

    resubmitted = api_client.post(f"/api/v1/submissions/{submission.id}/submit/", {}, format="json")

    assert resubmitted.status_code == 200
    assert timezone.datetime.fromisoformat(resubmitted.data["pending_since"]) > first_pending
    assert [event["new_state"] for event in resubmitted.data["history"]] == [
        "pending",
        "changes_requested",
        "draft",
        "pending",
    ]


@pytest.mark.django_db
def test_claim_is_explicit_exclusive_renewable_and_releasable(api_client: APIClient):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    first = make_operator(email="first@example.com")
    second = make_operator(email="second@example.com")
    claim_url = f"/api/v1/operator/submissions/{submission.id}/claim/"

    api_client.force_authenticate(first)
    detail = api_client.get(f"/api/v1/operator/submissions/{submission.id}/")
    claimed = api_client.post(claim_url, {}, format="json")
    api_client.force_authenticate(second)
    blocked = api_client.post(claim_url, {}, format="json")
    api_client.force_authenticate(first)
    renewed = api_client.post(f"{claim_url}renew/", {}, format="json")
    released = api_client.delete(claim_url)

    assert detail.status_code == 200
    assert detail.data["claim_status"] == "unclaimed"
    assert ReviewClaim.objects.count() == 1
    assert claimed.status_code == 201
    assert claimed.data["claim_status"] == "claimed_by_me"
    assert blocked.status_code == 409
    assert blocked.data["code"] == "review_claim_conflict"
    assert renewed.status_code == 200
    assert released.status_code == 204

    api_client.force_authenticate(second)
    reclaimed = api_client.post(claim_url, {}, format="json")
    assert reclaimed.status_code == 201
    assert ReviewClaim.objects.filter(submission=submission).count() == 2


@pytest.mark.django_db
def test_decision_requires_the_reviewed_revision_and_rejects_a_stale_revision(
    api_client: APIClient,
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    api_client.force_authenticate(operator)
    decision_url = f"/api/v1/operator/submissions/{submission.id}/reject/"

    assert (
        api_client.post(
            f"/api/v1/operator/submissions/{submission.id}/claim/", {}, format="json"
        ).status_code
        == 201
    )
    missing_revision = api_client.post(decision_url, {"reason": "رد"}, format="json")
    stale_revision = api_client.post(
        decision_url,
        {"reason": "رد", "reviewed_revision": submission.revision + 1},
        format="json",
    )

    assert missing_revision.status_code == 400
    assert "reviewed_revision" in missing_revision.data["errors"]
    assert stale_revision.status_code == 409
    assert stale_revision.data["code"] == "review_revision_conflict"
    submission.refresh_from_db()
    assert submission.state == SubmissionState.PENDING


@pytest.mark.django_db
def test_decision_requires_a_current_claim(api_client: APIClient):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    api_client.force_authenticate(operator)
    decision_url = f"/api/v1/operator/submissions/{submission.id}/reject/"

    unclaimed = api_client.post(
        decision_url,
        {"reason": "رد", "reviewed_revision": submission.revision},
        format="json",
    )
    assert (
        api_client.post(
            f"/api/v1/operator/submissions/{submission.id}/claim/", {}, format="json"
        ).status_code
        == 201
    )
    Submission.objects.filter(id=submission.id).update(revision=2)
    stale = api_client.post(
        decision_url,
        {"reason": "رد", "reviewed_revision": 1},
        format="json",
    )

    assert unclaimed.status_code == 409
    assert unclaimed.data["code"] == "review_claim_required"
    assert stale.status_code == 409
    assert stale.data["code"] == "review_revision_conflict"


@pytest.mark.django_db
def test_expired_claim_returns_an_explicit_decision_conflict(api_client: APIClient):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    api_client.force_authenticate(operator)
    claim_url = f"/api/v1/operator/submissions/{submission.id}/claim/"
    assert api_client.post(claim_url, {}, format="json").status_code == 201
    ReviewClaim.objects.update(expires_at=timezone.now() - timezone.timedelta(seconds=1))
    release_unavailable_review_claims()

    response = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/reject/",
        {"reason": "رد", "reviewed_revision": submission.revision},
        format="json",
    )

    assert response.status_code == 409
    assert response.data["code"] == "review_claim_expired"


@pytest.mark.django_db
def test_latest_released_claim_determines_the_decision_conflict(api_client: APIClient):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)
    ReviewClaim.objects.update(expires_at=timezone.now() - timezone.timedelta(seconds=1))
    release_unavailable_review_claims()
    claim_submission_review(submission=submission, actor=operator)
    release_submission_review_claim(submission=submission, actor=operator)
    api_client.force_authenticate(operator)

    response = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/reject/",
        {"reason": "رد", "reviewed_revision": submission.revision},
        format="json",
    )

    assert response.status_code == 409
    assert response.data["code"] == "review_claim_required"


@pytest.mark.django_db
def test_replaced_claim_returns_an_explicit_decision_conflict(api_client: APIClient):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    original = make_operator(email="original@example.com")
    replacement = make_operator(email="replacement@example.com")
    lead = make_operator(email="lead-replacement@example.com")
    lead.user_permissions.add(
        Permission.objects.get(content_type__app_label="accounts", codename="manage_operator_queue")
    )
    claim_url = f"/api/v1/operator/submissions/{submission.id}/claim/"
    api_client.force_authenticate(original)
    assert api_client.post(claim_url, {}, format="json").status_code == 201
    api_client.force_authenticate(lead)
    assert (
        api_client.post(
            f"{claim_url}force-release/",
            {"reason": "انتقال مسئولیت"},
            format="json",
        ).status_code
        == 204
    )
    api_client.force_authenticate(replacement)
    assert api_client.post(claim_url, {}, format="json").status_code == 201

    api_client.force_authenticate(original)
    response = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/request-changes/",
        {"reason": "اصلاح", "reviewed_revision": submission.revision},
        format="json",
    )

    assert response.status_code == 409
    assert response.data["code"] == "review_claim_replaced"


@pytest.mark.django_db
def test_repeated_decision_returns_an_explicit_concurrent_decision_conflict(
    api_client: APIClient,
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    api_client.force_authenticate(operator)
    assert (
        api_client.post(
            f"/api/v1/operator/submissions/{submission.id}/claim/", {}, format="json"
        ).status_code
        == 201
    )
    body = {"reason": "رد", "reviewed_revision": submission.revision}
    decision_url = f"/api/v1/operator/submissions/{submission.id}/reject/"
    assert api_client.post(decision_url, body, format="json").status_code == 200

    repeated = api_client.post(decision_url, body, format="json")

    assert repeated.status_code == 409
    assert repeated.data["code"] == "review_decision_conflict"


@pytest.mark.django_db
def test_lead_can_force_release_with_an_audited_reason(api_client: APIClient):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    reviewer = make_operator(email="reviewer@example.com")
    lead = make_operator(email="lead@example.com")
    lead.user_permissions.add(
        Permission.objects.get(content_type__app_label="accounts", codename="manage_operator_queue")
    )
    claim_url = f"/api/v1/operator/submissions/{submission.id}/claim/"
    api_client.force_authenticate(reviewer)
    assert api_client.post(claim_url, {}, format="json").status_code == 201

    api_client.force_authenticate(lead)
    missing = api_client.post(f"{claim_url}force-release/", {"reason": ""}, format="json")
    released = api_client.post(
        f"{claim_url}force-release/", {"reason": "مرورگر اپراتور از دسترس خارج شد"}, format="json"
    )

    assert missing.status_code == 400
    assert released.status_code == 204
    claim = ReviewClaim.objects.get(submission=submission)
    assert claim.released_by == lead
    assert claim.release_reason == "مرورگر اپراتور از دسترس خارج شد"


@pytest.mark.django_db
@pytest.mark.parametrize("access_change", ["expired", "deactivated", "revoked"])
def test_unavailable_claim_becomes_reclaimable_on_the_next_request(
    api_client: APIClient, access_change: str
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    first = make_operator(email="first-holder@example.com")
    second = make_operator(email="next-reviewer@example.com")
    api_client.force_authenticate(first)
    claim_url = f"/api/v1/operator/submissions/{submission.id}/claim/"
    assert api_client.post(claim_url, {}, format="json").status_code == 201
    if access_change == "expired":
        ReviewClaim.objects.update(expires_at=timezone.now() - timezone.timedelta(seconds=1))
    elif access_change == "deactivated":
        first.is_active = False
        first.save(update_fields=("is_active",))
    else:
        first.user_permissions.remove(review_permission())

    api_client.force_authenticate(second)
    reclaimed = api_client.post(claim_url, {}, format="json")

    assert reclaimed.status_code == 201
    claims = list(ReviewClaim.objects.filter(submission=submission).order_by("created_at"))
    assert claims[0].released_at is not None
    assert claims[1].operator == second


@pytest.mark.django_db
def test_queue_filters_age_and_assignment_without_counting_self_work(api_client: APIClient):
    operator = make_operator()
    unclaimed = make_complete_submission(email="unclaimed-filter@example.com")
    mine = make_complete_submission(email="mine-filter@example.com")
    self_work = make_complete_submission(email="temporary-self-filter@example.com")
    self_work.submitter = operator
    self_work.save(update_fields=("submitter",))
    for submission in (unclaimed, mine, self_work):
        submit_for_review(submission=submission, actor=submission.submitter)
        Submission.objects.filter(id=submission.id).update(
            pending_since=timezone.now() - timezone.timedelta(days=3)
        )
    claim_submission_review(submission=mine, actor=operator)
    api_client.force_authenticate(operator)

    response = api_client.get("/api/v1/operator/submissions/", {"assignee": "mine", "age_days": 2})

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert [item["id"] for item in response.data["results"]] == [str(mine.id)]


@pytest.mark.django_db
def test_submission_summary_counts_only_actionable_review_work_visible_to_operator(
    api_client: APIClient,
):
    operator = make_operator()
    unclaimed = make_complete_submission(email="summary-unclaimed@example.com")
    mine = make_complete_submission(email="summary-mine@example.com")
    recent = make_complete_submission(email="summary-recent@example.com")
    self_work = make_complete_submission(email="summary-self@example.com")
    self_work.submitter = operator
    self_work.save(update_fields=("submitter",))
    for submission in (unclaimed, mine, recent, self_work):
        submit_for_review(submission=submission, actor=submission.submitter)
    Submission.objects.filter(id__in=(unclaimed.id, mine.id, self_work.id)).update(
        pending_since=timezone.now() - timezone.timedelta(hours=49)
    )
    claim_submission_review(submission=mine, actor=operator)
    api_client.force_authenticate(operator)

    response = api_client.get("/api/v1/operator/submissions/summary/")

    assert response.status_code == 200
    assert response.data == {
        "unclaimed_count": 2,
        "assigned_to_me_count": 1,
        "aging_count": 2,
        "aging_after_hours": 48,
    }


@pytest.mark.django_db(transaction=True)
def test_competing_claims_have_one_winner():
    if connection.vendor != "postgresql":
        pytest.skip("row-lock concurrency behavior is PostgreSQL-specific")
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operators = (
        make_operator(email="claim-one@example.com"),
        make_operator(email="claim-two@example.com"),
    )

    def claim(index: int) -> str:
        close_old_connections()
        try:
            claim_submission_review(
                submission=Submission.objects.get(id=submission.id),
                actor=User.objects.get(id=operators[index].id),
            )
        except ReviewWorkflowConflict:
            return "lost"
        finally:
            close_old_connections()
        return "won"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, range(2)))

    assert results.count("won") == 1
    assert ReviewClaim.objects.filter(submission=submission, released_at__isnull=True).count() == 1


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("email_verified", "is_active"),
    [(False, True), (True, False)],
)
def test_submission_review_requires_an_active_verified_operator(
    api_client: APIClient,
    email_verified: bool,
    is_active: bool,
):
    operator = User.objects.create_user(
        email="restricted-operator@example.com",
        password="password",
        email_verified_at=timezone.now() if email_verified else None,
        is_active=is_active,
    )
    operator.user_permissions.add(review_permission())
    api_client.force_authenticate(operator)

    response = api_client.get("/api/v1/operator/submissions/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_operator_cannot_see_or_decide_their_own_submission(api_client: APIClient):
    submission = make_complete_submission(email="dual-role@example.com")
    submit_for_review(submission=submission, actor=submission.submitter)
    submission.submitter.user_permissions.add(review_permission())
    api_client.force_authenticate(submission.submitter)

    queue = api_client.get("/api/v1/operator/submissions/")
    decision = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/reject/",
        {"reason": "self review", "reviewed_revision": submission.revision},
        format="json",
    )

    assert queue.status_code == 200
    assert str(submission.id) not in {item["id"] for item in queue.data["results"]}
    assert decision.status_code == 404

    with pytest.raises(ValidationError, match="own Submission"):
        reject_submission(
            submission=submission,
            actor=submission.submitter,
            reviewed_revision=submission.revision,
            reason="self review",
        )


@pytest.mark.django_db(transaction=True)
def test_concurrent_submission_of_one_revision_has_one_winner():
    if connection.vendor != "postgresql":
        pytest.skip("row-lock concurrency behavior is PostgreSQL-specific")
    submission = make_complete_submission()

    def attempt() -> str:
        close_old_connections()
        try:
            submit_for_review(
                submission=Submission.objects.get(id=submission.id),
                actor=User.objects.get(id=submission.submitter_id),
            )
        except Exception as exc:  # noqa: BLE001 - the losing transition is the assertion
            return type(exc).__name__
        finally:
            close_old_connections()
        return "submitted"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: attempt(), range(2)))

    assert results.count("submitted") == 1
    assert (
        SubmissionEvent.objects.filter(
            submission=submission,
            revision=1,
            new_state=SubmissionState.PENDING,
        ).count()
        == 1
    )


@pytest.mark.django_db(transaction=True)
def test_competing_operator_decisions_have_one_winner():
    if connection.vendor != "postgresql":
        pytest.skip("row-lock concurrency behavior is PostgreSQL-specific")
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operators = (
        make_operator(email="changes@example.com"),
        make_operator(email="reject@example.com"),
    )
    claim_submission_review(submission=submission, actor=operators[0])

    def decide(index: int) -> str:
        close_old_connections()
        try:
            locked_submission = Submission.objects.get(id=submission.id)
            operator = User.objects.get(id=operators[index].id)
            if index == 0:
                request_submission_changes(
                    submission=locked_submission,
                    actor=operator,
                    reviewed_revision=locked_submission.revision,
                    reason="نیازمند اصلاح",
                )
            else:
                reject_submission(
                    submission=locked_submission,
                    actor=operator,
                    reviewed_revision=locked_submission.revision,
                    reason="رد نهایی",
                )
        except ValidationError, ReviewWorkflowConflict:
            return "lost"
        finally:
            close_old_connections()
        return "won"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(decide, range(2)))

    submission.refresh_from_db()
    assert results.count("won") == 1
    assert submission.state in (SubmissionState.CHANGES_REQUESTED, SubmissionState.REJECTED)
    assert SubmissionEvent.objects.filter(submission=submission).count() == 2


@pytest.mark.django_db(transaction=True)
def test_competing_approvals_publish_one_listing():
    if connection.vendor != "postgresql":
        pytest.skip("row-lock concurrency behavior is PostgreSQL-specific")
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operators = (
        make_operator(email="approve-one@example.com"),
        make_operator(email="approve-two@example.com"),
    )
    claim_submission_review(submission=submission, actor=operators[0])

    def approve(index: int) -> str:
        close_old_connections()
        try:
            approve_submission(
                submission=Submission.objects.get(id=submission.id),
                actor=User.objects.get(id=operators[index].id),
                reviewed_revision=submission.revision,
            )
        except ValidationError, ReviewWorkflowConflict:
            return "lost"
        finally:
            close_old_connections()
        return "won"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(approve, range(2)))

    submission.refresh_from_db()
    assert results.count("won") == 1
    assert submission.state == SubmissionState.PUBLISHED
    assert Listing.objects.filter(submission=submission).count() == 1
    assert (
        SubmissionEvent.objects.filter(
            submission=submission,
            new_state=SubmissionState.PUBLISHED,
        ).count()
        == 1
    )
