from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from django.contrib.auth.models import Permission
from django.core.exceptions import ValidationError
from django.db import close_old_connections, connection
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
    Submission,
    SubmissionEvent,
    SubmissionImage,
    SubmissionImageStatus,
    SubmissionState,
)
from apps.submissions.services import (
    approve_submission,
    reject_submission,
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


def make_complete_submission(*, email: str = "submitter@example.com") -> Submission:
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
        property_type="apartment",
        area_sqm=110,
        room_count=2,
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

    missing_reason = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/request-changes/",
        {"reason": ""},
        format="json",
    )
    requested = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/request-changes/",
        {"reason": "شماره تماس را اصلاح کنید."},
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

    denied = api_client.post(url, {"reason": "محتوای ممنوع"}, format="json")
    api_client.force_authenticate(submission.submitter)
    submitter_approval = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/approve/", {}, format="json"
    )
    api_client.force_authenticate(make_operator())
    rejected = api_client.post(url, {"reason": "محتوای ممنوع"}, format="json")
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
    api_client.force_authenticate(make_operator())

    approved = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/approve/",
        {
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
    api_client.force_authenticate(make_operator())
    approved = api_client.post(
        f"/api/v1/operator/submissions/{submission.id}/approve/",
        {"property_id": str(existing.id)},
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
            "updated_after": (timezone.now() - timezone.timedelta(minutes=5)).isoformat(),
            "ordering": "oldest",
        },
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.data] == [str(pending.id)]
    assert str(other.id) not in {item["id"] for item in response.data}


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
        {"reason": "self review"},
        format="json",
    )

    assert queue.status_code == 200
    assert str(submission.id) not in {item["id"] for item in queue.data}
    assert decision.status_code == 404

    with pytest.raises(ValidationError, match="own Submission"):
        reject_submission(
            submission=submission,
            actor=submission.submitter,
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

    def decide(index: int) -> str:
        close_old_connections()
        try:
            locked_submission = Submission.objects.get(id=submission.id)
            operator = User.objects.get(id=operators[index].id)
            if index == 0:
                request_submission_changes(
                    submission=locked_submission,
                    actor=operator,
                    reason="نیازمند اصلاح",
                )
            else:
                reject_submission(
                    submission=locked_submission,
                    actor=operator,
                    reason="رد نهایی",
                )
        except ValidationError:
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

    def approve(index: int) -> str:
        close_old_connections()
        try:
            approve_submission(
                submission=Submission.objects.get(id=submission.id),
                actor=User.objects.get(id=operators[index].id),
            )
        except ValidationError:
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
