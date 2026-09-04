from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.contrib.auth.models import Group, Permission
from django.db import close_old_connections, connection
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.communications.models import ListingInquiry, ListingInquiryMessage, SystemNotification
from apps.source_proposals.models import SourceProposal, SourceProposalEvent
from apps.source_proposals.serializers import SourceProposalEventSerializer
from apps.source_proposals.services import (
    claim_source_proposal_review,
    request_source_proposal_changes,
)
from apps.submissions.models import Submission, SubmissionEvent
from apps.submissions.serializers import SubmissionEventSerializer
from apps.submissions.services import (
    claim_submission_review,
    request_submission_changes,
    submit_for_review,
)
from tests.test_listing_inquiries import make_listing, verified_user
from tests.test_source_proposal_review import (
    make_operator as make_source_operator,
)
from tests.test_source_proposal_review import (
    make_pending_proposal,
)
from tests.test_source_proposal_review import (
    make_user as make_source_user,
)
from tests.test_submission_review import make_complete_submission, make_operator


def start_inquiry_with_reply(
    api_client: APIClient, *, renter: User, submitter: User
) -> ListingInquiry:
    listing = make_listing(submitter=submitter)
    api_client.force_authenticate(renter)
    created = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "پیام مستاجر"},
        format="json",
    )
    assert created.status_code == 201
    api_client.force_authenticate(submitter)
    replied = api_client.post(
        f"/api/v1/messages/listing-inquiries/{created.data['id']}/replies/",
        {"body": "پاسخ مالک"},
        format="json",
    )
    assert replied.status_code == 201
    return ListingInquiry.objects.get(id=created.data["id"])


def grant_conversation_moderator(account: User) -> None:
    group, _created = Group.objects.get_or_create(name="Conversation Moderator")
    group.permissions.add(Permission.objects.get(codename="moderate_conversation_reports"))
    account.groups.add(group)


@pytest.mark.django_db
def test_remaining_participant_sees_neutral_identity_after_counterpart_deletion(
    api_client: APIClient,
):
    renter = verified_user("renter@example.com", "نام مستاجر")
    submitter = verified_user("submitter@example.com", "نام مالک")
    inquiry = start_inquiry_with_reply(api_client, renter=renter, submitter=submitter)

    renter.delete()

    assert ListingInquiry.objects.filter(id=inquiry.id).exists()
    assert ListingInquiryMessage.objects.filter(inquiry_id=inquiry.id).count() == 2
    api_client.force_authenticate(submitter)
    feed = api_client.get("/api/v1/messages/?kind=listing_inquiry")
    detail = api_client.get(f"/api/v1/messages/{inquiry.id}/")
    block = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry.id}/block/",
        {},
        format="json",
    )

    assert feed.status_code == detail.status_code == 200
    assert feed.data["count"] == 1
    assert detail.data["counterpart"] == {
        "display_name": "حساب حذف‌شده",
        "role": "renter",
        "identity_verified": False,
        "deleted": True,
    }
    assert detail.data["reply_allowed"] is False
    assert detail.data["reply_unavailable_reason"] == "account_deleted"
    assert [entry["kind"] for entry in detail.data["entries"]] == [
        "renter_message",
        "submitter_message",
    ]
    assert [entry["author_name"] for entry in detail.data["entries"]] == [
        "حساب حذف‌شده",
        "نام مالک",
    ]
    assert block.status_code == 400


@pytest.mark.django_db
def test_deleting_both_participants_physically_removes_unheld_inquiry(
    api_client: APIClient,
):
    renter = verified_user("renter@example.com", "نام مستاجر")
    submitter = verified_user("submitter@example.com", "نام مالک")
    inquiry = start_inquiry_with_reply(api_client, renter=renter, submitter=submitter)

    renter.delete()
    submitter.delete()

    assert not ListingInquiry.objects.filter(id=inquiry.id).exists()
    assert not ListingInquiryMessage.objects.filter(inquiry_id=inquiry.id).exists()


@pytest.mark.django_db
def test_active_report_delays_cleanup_until_its_evidence_is_released(
    api_client: APIClient,
):
    renter = verified_user("renter@example.com", "نام مستاجر")
    submitter = verified_user("submitter@example.com", "نام مالک")
    inquiry = start_inquiry_with_reply(api_client, renter=renter, submitter=submitter)
    api_client.force_authenticate(renter)
    reported = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry.id}/reports/",
        {},
        format="json",
    )
    assert reported.status_code == 201

    renter.delete()
    submitter.delete()

    assert ListingInquiry.objects.filter(id=inquiry.id).exists()
    moderator = verified_user("moderator@example.com", "ناظر")
    grant_conversation_moderator(moderator)
    api_client.force_authenticate(moderator)
    dismissed = api_client.post(
        f"/api/v1/operator/conversation-reports/{reported.data['id']}/decision/",
        {"decision": "dismissed"},
        format="json",
    )

    assert dismissed.status_code == 200
    assert not ListingInquiry.objects.filter(id=inquiry.id).exists()
    assert not ListingInquiryMessage.objects.filter(inquiry_id=inquiry.id).exists()


@pytest.mark.django_db
def test_required_hold_delays_cleanup_until_final_release(api_client: APIClient):
    renter = verified_user("renter@example.com", "نام مستاجر")
    submitter = verified_user("submitter@example.com", "نام مالک")
    inquiry = start_inquiry_with_reply(api_client, renter=renter, submitter=submitter)
    api_client.force_authenticate(renter)
    reported = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry.id}/reports/",
        {},
        format="json",
    )
    second_report = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry.id}/reports/",
        {},
        format="json",
    )
    moderator = verified_user("moderator@example.com", "ناظر")
    grant_conversation_moderator(moderator)
    api_client.force_authenticate(moderator)
    upheld = api_client.post(
        f"/api/v1/operator/conversation-reports/{reported.data['id']}/decision/",
        {"decision": "upheld"},
        format="json",
    )
    second_upheld = api_client.post(
        f"/api/v1/operator/conversation-reports/{second_report.data['id']}/decision/",
        {"decision": "upheld"},
        format="json",
    )
    assert upheld.status_code == second_upheld.status_code == 200

    renter.delete()
    submitter.delete()

    assert ListingInquiry.objects.filter(id=inquiry.id).exists()
    first_release = api_client.post(
        f"/api/v1/operator/conversation-reports/{reported.data['id']}/evidence-release/",
        {"internal_note": "دوره نگهداری قانونی پایان یافت."},
        format="json",
    )
    assert first_release.status_code == 200
    assert ListingInquiry.objects.filter(id=inquiry.id).exists()
    final_release = api_client.post(
        f"/api/v1/operator/conversation-reports/{second_report.data['id']}/evidence-release/",
        {"internal_note": "آخرین دوره نگهداری قانونی پایان یافت."},
        format="json",
    )

    assert final_release.status_code == 200
    assert not ListingInquiry.objects.filter(id=inquiry.id).exists()
    assert not ListingInquiryMessage.objects.filter(inquiry_id=inquiry.id).exists()


@pytest.mark.django_db
def test_submission_recipient_deletion_removes_notification_and_preserves_history():
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)
    request_submission_changes(
        submission=submission,
        actor=operator,
        reviewed_revision=submission.revision,
        reason="مدرک تکمیلی لازم است.",
    )
    notification = SystemNotification.objects.get()
    recipient = submission.submitter
    history_before = list(
        SubmissionEvent.objects.filter(submission=submission).values(
            "id", "prior_state", "new_state", "reason"
        )
    )

    recipient.delete()

    assert not SystemNotification.objects.filter(id=notification.id).exists()
    assert Submission.objects.filter(id=submission.id, submitter__isnull=True).exists()
    assert (
        list(
            SubmissionEvent.objects.filter(submission=submission).values(
                "id", "prior_state", "new_state", "reason"
            )
        )
        == history_before
    )
    deleted_actor_events = SubmissionEvent.objects.filter(submission=submission, actor__isnull=True)
    assert deleted_actor_events.exists()
    for event in deleted_actor_events:
        serialized = SubmissionEventSerializer(event).data
        assert serialized["actor_reference"] is None
        assert serialized["actor_label"] == "Former account"
        assert serialized["actor_email"] is None


@pytest.mark.django_db
def test_source_proposal_recipient_deletion_removes_notification_and_preserves_history():
    representative = make_source_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=representative,
        revision=proposal.revision,
        prior_state="draft",
        new_state="pending",
    )
    operator = make_source_operator()
    claim_source_proposal_review(proposal=proposal, actor=operator)
    request_source_proposal_changes(
        proposal=proposal,
        actor=operator,
        reviewed_revision=proposal.revision,
        reason="مدرک نمایندگی را تکمیل کنید.",
    )
    notification = SystemNotification.objects.get()
    history_before = list(
        SourceProposalEvent.objects.filter(proposal=proposal).values(
            "id", "prior_state", "new_state", "reason"
        )
    )

    representative.delete()

    assert not SystemNotification.objects.filter(id=notification.id).exists()
    assert SourceProposal.objects.filter(id=proposal.id, submitter__isnull=True).exists()
    assert (
        list(
            SourceProposalEvent.objects.filter(proposal=proposal).values(
                "id", "prior_state", "new_state", "reason"
            )
        )
        == history_before
    )
    deleted_actor_events = SourceProposalEvent.objects.filter(proposal=proposal, actor__isnull=True)
    assert deleted_actor_events.exists()
    for event in deleted_actor_events:
        serialized = SourceProposalEventSerializer(event).data
        assert serialized["actor_label"] == "Former account"


@pytest.mark.django_db
def test_report_creation_after_counterpart_deletion_fails_without_exposing_identity(
    api_client: APIClient,
):
    renter = verified_user("renter@example.com", "نام مستاجر")
    submitter = verified_user("submitter@example.com", "نام مالک")
    inquiry = start_inquiry_with_reply(api_client, renter=renter, submitter=submitter)
    renter.delete()
    api_client.force_authenticate(submitter)

    response = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry.id}/reports/",
        {},
        format="json",
    )

    assert response.status_code == 400
    assert response.data["errors"]["detail"][0]["code"] == "account_deleted"


@pytest.mark.django_db(transaction=True)
def test_concurrent_participant_deletions_cleanup_once(api_client: APIClient):
    if connection.vendor != "postgresql":
        pytest.skip("Concurrent retention behavior requires PostgreSQL row locks.")
    renter = verified_user("renter@example.com", "نام مستاجر")
    submitter = verified_user("submitter@example.com", "نام مالک")
    inquiry = start_inquiry_with_reply(api_client, renter=renter, submitter=submitter)
    barrier = Barrier(2)

    def delete_account(account_id) -> None:
        close_old_connections()
        account = User.objects.get(id=account_id)
        barrier.wait()
        account.delete()
        close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(delete_account, renter.id),
            executor.submit(delete_account, submitter.id),
        ]
        for future in futures:
            future.result(timeout=10)

    assert not ListingInquiry.objects.filter(id=inquiry.id).exists()
    assert not ListingInquiryMessage.objects.filter(inquiry_id=inquiry.id).exists()


@pytest.mark.django_db(transaction=True)
def test_concurrent_account_deletion_and_report_creation_are_serialized(
    api_client: APIClient,
):
    if connection.vendor != "postgresql":
        pytest.skip("Concurrent retention behavior requires PostgreSQL row locks.")
    renter = verified_user("renter@example.com", "نام مستاجر")
    submitter = verified_user("submitter@example.com", "نام مالک")
    inquiry = start_inquiry_with_reply(api_client, renter=renter, submitter=submitter)
    barrier = Barrier(2)

    def delete_renter() -> None:
        close_old_connections()
        account = User.objects.get(id=renter.id)
        barrier.wait()
        account.delete()
        close_old_connections()

    def report_inquiry() -> int:
        close_old_connections()
        client = APIClient()
        client.force_authenticate(User.objects.get(id=submitter.id))
        barrier.wait()
        response = client.post(
            f"/api/v1/messages/listing-inquiries/{inquiry.id}/reports/",
            {},
            format="json",
        )
        close_old_connections()
        return response.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        deleted = executor.submit(delete_renter)
        reported = executor.submit(report_inquiry)
        deleted.result(timeout=10)
        report_status = reported.result(timeout=10)

    assert report_status in (201, 400)
    submitter.delete()
    if report_status == 201:
        assert ListingInquiry.objects.filter(id=inquiry.id).exists()
    else:
        assert not ListingInquiry.objects.filter(id=inquiry.id).exists()


@pytest.mark.django_db(transaction=True)
def test_concurrent_report_decision_and_final_participant_deletion_do_not_deadlock(
    api_client: APIClient,
):
    if connection.vendor != "postgresql":
        pytest.skip("Concurrent retention behavior requires PostgreSQL row locks.")
    renter = verified_user("renter@example.com", "نام مستاجر")
    submitter = verified_user("submitter@example.com", "نام مالک")
    inquiry = start_inquiry_with_reply(api_client, renter=renter, submitter=submitter)
    api_client.force_authenticate(renter)
    reported = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry.id}/reports/",
        {},
        format="json",
    )
    moderator = verified_user("moderator@example.com", "ناظر")
    grant_conversation_moderator(moderator)
    submitter.delete()
    barrier = Barrier(2)

    def delete_reporter() -> None:
        close_old_connections()
        account = User.objects.get(id=renter.id)
        barrier.wait()
        account.delete()
        close_old_connections()

    def dismiss_report() -> int:
        close_old_connections()
        client = APIClient()
        client.force_authenticate(User.objects.get(id=moderator.id))
        barrier.wait()
        response = client.post(
            f"/api/v1/operator/conversation-reports/{reported.data['id']}/decision/",
            {"decision": "dismissed"},
            format="json",
        )
        close_old_connections()
        return response.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        deleted = executor.submit(delete_reporter)
        dismissed = executor.submit(dismiss_report)
        deleted.result(timeout=10)
        assert dismissed.result(timeout=10) == 200

    assert not ListingInquiry.objects.filter(id=inquiry.id).exists()
    assert not ListingInquiryMessage.objects.filter(inquiry_id=inquiry.id).exists()
