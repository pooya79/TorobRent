from unittest.mock import patch

import pytest
from django.core.exceptions import ValidationError
from django.db import transaction

from apps.communications.models import SystemNotification, SystemNotificationReadState
from apps.communications.services import create_submission_review_notification
from apps.contact.models import IntakeKind, SupportRequest
from apps.submissions.models import SubmissionDecisionNotification, SubmissionEvent
from apps.submissions.services import (
    approve_submission,
    claim_submission_review,
    reject_submission,
    request_submission_changes,
    submit_for_review,
)
from tests.test_submission_review import make_complete_submission, make_operator


@pytest.mark.django_db
def test_review_outcome_creates_an_in_app_notification_in_the_decision_transaction(
    django_capture_on_commit_callbacks,
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)

    with (
        patch("celery.app.task.Task.apply_async") as apply_async,
        django_capture_on_commit_callbacks(execute=True),
    ):
        request_submission_changes(
            submission=submission,
            actor=operator,
            reviewed_revision=submission.revision,
            reason="شماره تماس را اصلاح کنید.",
        )

    notification = SystemNotification.objects.get()
    assert notification.recipient == submission.submitter
    assert notification.originating_event.new_state == "changes_requested"
    assert notification.target_submission == submission
    assert not SubmissionDecisionNotification.objects.exists()
    apply_async.assert_not_called()


@pytest.mark.django_db
@pytest.mark.parametrize("outcome", ("rejected", "published"))
def test_each_terminal_review_outcome_creates_one_notification(outcome: str):
    submission = make_complete_submission(email=f"{outcome}@example.com")
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator(email=f"{outcome}-operator@example.com")
    claim_submission_review(submission=submission, actor=operator)

    if outcome == "rejected":
        reject_submission(
            submission=submission,
            actor=operator,
            reviewed_revision=submission.revision,
            reason="پیشنهاد قابل انتشار نیست.",
        )
    else:
        approve_submission(
            submission=submission,
            actor=operator,
            reviewed_revision=submission.revision,
        )

    assert list(
        SystemNotification.objects.values_list("originating_event__new_state", flat=True)
    ) == [outcome]


@pytest.mark.django_db
def test_publication_notification_does_not_expose_the_operator_internal_note(api_client):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)
    approve_submission(
        submission=submission,
        actor=operator,
        reviewed_revision=submission.revision,
        internal_note="یادداشت خصوصی اپراتور درباره مدارک منبع",
    )
    notification = SystemNotification.objects.get()
    api_client.force_authenticate(submission.submitter)

    response = api_client.get(f"/api/v1/messages/{notification.id}/")

    assert response.status_code == 200
    assert response.data["body"] == "پیشنهاد شما بررسی و منتشر شد."
    assert "خصوصی" not in response.data["body"]


@pytest.mark.django_db
def test_rolled_back_review_outcome_leaves_no_notification():
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)

    with pytest.raises(RuntimeError, match="roll back"), transaction.atomic():
        reject_submission(
            submission=submission,
            actor=operator,
            reviewed_revision=submission.revision,
            reason="رد نهایی",
        )
        raise RuntimeError("roll back")

    assert not SystemNotification.objects.exists()


@pytest.mark.django_db
def test_verified_account_lists_notifications_without_submitter_onboarding(api_client):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)
    request_submission_changes(
        submission=submission,
        actor=operator,
        reviewed_revision=submission.revision,
        reason="شماره تماس را اصلاح کنید.",
    )
    submission.submitter.is_submitter = False
    submission.submitter.save(update_fields=("is_submitter",))
    api_client.force_authenticate(submission.submitter)

    response = api_client.get("/api/v1/messages/")

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"] == [
        {
            "id": str(SystemNotification.objects.get().id),
            "kind": "system_notification",
            "title": "اصلاح پیشنهاد لازم است",
            "preview": "شماره تماس را اصلاح کنید.",
            "created_at": response.data["results"][0]["created_at"],
            "read": False,
            "group": {
                "kind": "submission",
                "id": str(submission.id),
                "label": "پیشنهاد ملک",
            },
        }
    ]
    detail = api_client.get(f"/api/v1/messages/{SystemNotification.objects.get().id}/")
    assert detail.status_code == 200
    assert detail.data["target"] is None

    submission.submitter.is_submitter = True
    submission.submitter.phone_verified_at = None
    submission.submitter.save(update_fields=("is_submitter", "phone_verified_at"))
    email_only_detail = api_client.get(f"/api/v1/messages/{SystemNotification.objects.get().id}/")
    assert email_only_detail.status_code == 200
    assert email_only_detail.data["target"] is None


@pytest.mark.django_db
def test_opening_detail_marks_read_and_account_can_mark_it_unread(api_client):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)
    request_submission_changes(
        submission=submission,
        actor=operator,
        reviewed_revision=submission.revision,
        reason="تصاویر را اصلاح کنید.",
    )
    notification = SystemNotification.objects.get()
    api_client.force_authenticate(submission.submitter)

    assert api_client.get("/api/v1/messages/").data["results"][0]["read"] is False
    assert api_client.get("/api/v1/messages/unread-count/").data == {"count": 1}
    opened = api_client.get(f"/api/v1/messages/{notification.id}/")

    assert opened.status_code == 200
    assert opened.data == {
        "id": str(notification.id),
        "kind": "system_notification",
        "title": "اصلاح پیشنهاد لازم است",
        "preview": "تصاویر را اصلاح کنید.",
        "body": "تصاویر را اصلاح کنید.",
        "created_at": opened.data["created_at"],
        "read": True,
        "public_status": None,
        "reply_allowed": False,
        "reply_unavailable_reason": None,
        "counterpart": None,
        "listing_context": None,
        "entries": [],
        "target": {
            "label": "مشاهده پیشنهاد",
            "href": f"/dashboard#submission-{submission.id}",
        },
        "group": {
            "kind": "submission",
            "id": str(submission.id),
            "label": "پیشنهاد ملک",
        },
    }
    assert api_client.get("/api/v1/messages/").data["results"][0]["read"] is True
    assert api_client.get("/api/v1/messages/unread-count/").data == {"count": 0}

    unread = api_client.patch(
        f"/api/v1/messages/{notification.id}/", {"read": False}, format="json"
    )

    assert unread.status_code == 200
    assert unread.data["read"] is False


@pytest.mark.django_db
def test_feed_filters_unread_and_future_kinds_in_latest_activity_order(api_client):
    submission = make_complete_submission()
    first_event = SubmissionEvent.objects.create(
        submission=submission,
        actor=submission.submitter,
        revision=1,
        prior_state="pending",
        new_state="changes_requested",
        reason="اصلاح نخست",
    )
    second_event = SubmissionEvent.objects.create(
        submission=submission,
        actor=submission.submitter,
        revision=1,
        prior_state="pending",
        new_state="rejected",
        reason="رد نهایی",
    )
    first = SystemNotification.objects.create(
        recipient=submission.submitter,
        originating_event=first_event,
        target_submission=submission,
    )
    second = SystemNotification.objects.create(
        recipient=submission.submitter,
        originating_event=second_event,
        target_submission=submission,
    )
    SystemNotificationReadState.objects.create(notification=second)
    api_client.force_authenticate(submission.submitter)

    all_items = api_client.get("/api/v1/messages/").data["results"]
    unread_items = api_client.get("/api/v1/messages/?unread=true").data["results"]
    future_kind = api_client.get("/api/v1/messages/?kind=listing_inquiry").data

    assert [item["id"] for item in all_items] == [str(second.id), str(first.id)]
    assert [item["id"] for item in unread_items] == [str(first.id)]
    assert future_kind["count"] == 0


@pytest.mark.django_db
def test_feed_paginates_a_combined_notification_and_support_request_timeline(api_client):
    submission = make_complete_submission()
    for index in range(15):
        event = SubmissionEvent.objects.create(
            submission=submission,
            actor=submission.submitter,
            revision=index + 1,
            prior_state="pending",
            new_state="rejected",
            reason=f"تصمیم {index}",
        )
        SystemNotification.objects.create(
            recipient=submission.submitter,
            originating_event=event,
            target_submission=submission,
        )
        SupportRequest.objects.create(
            submitter=submission.submitter,
            name="درخواست‌کننده",
            email=submission.submitter.email,
            intake_kind=IntakeKind.GENERAL,
            subject=f"پشتیبانی {index}",
            message=f"پیام {index}",
            account_linked_at_intake=True,
        )
    api_client.force_authenticate(submission.submitter)

    pages = [
        api_client.get(f"/api/v1/messages/?page={page}&page_size=10").data for page in range(1, 4)
    ]

    assert [page["count"] for page in pages] == [30, 30, 30]
    assert [len(page["results"]) for page in pages] == [10, 10, 10]
    ids = [item["id"] for page in pages for item in page["results"]]
    assert len(set(ids)) == 30
    assert pages[0]["previous"] is None
    assert pages[0]["next"].endswith("page=2&page_size=10")
    assert pages[2]["next"] is None


@pytest.mark.django_db
def test_detail_hides_other_accounts_and_disables_a_stale_target(api_client):
    submission = make_complete_submission()
    event = SubmissionEvent.objects.create(
        submission=submission,
        actor=submission.submitter,
        revision=1,
        prior_state="pending",
        new_state="rejected",
        reason="رد نهایی",
    )
    notification = SystemNotification.objects.create(
        recipient=submission.submitter,
        originating_event=event,
        target_submission=None,
    )
    other_account = make_operator(permitted=False)
    api_client.force_authenticate(other_account)

    hidden = api_client.get(f"/api/v1/messages/{notification.id}/")

    assert hidden.status_code == 404
    assert not SystemNotificationReadState.objects.exists()

    api_client.force_authenticate(submission.submitter)
    visible = api_client.get(f"/api/v1/messages/{notification.id}/")
    assert visible.status_code == 200
    assert visible.data["body"] == "رد نهایی"
    assert visible.data["target"] is None


@pytest.mark.django_db
def test_unverified_and_logged_out_accounts_cannot_open_message_center(api_client, user):
    assert api_client.get("/api/v1/messages/").status_code in (401, 403)
    api_client.force_authenticate(user)
    assert api_client.get("/api/v1/messages/").status_code == 403


@pytest.mark.django_db
def test_notification_creation_is_idempotent_and_history_is_immutable():
    submission = make_complete_submission()
    event = SubmissionEvent.objects.create(
        submission=submission,
        actor=submission.submitter,
        revision=1,
        prior_state="pending",
        new_state="published",
    )

    first = create_submission_review_notification(event)
    second = create_submission_review_notification(event)

    assert first == second
    assert SystemNotification.objects.count() == 1
    first.target_submission = None
    with pytest.raises(ValidationError, match="immutable"):
        first.save()
    with pytest.raises(ValidationError, match="immutable"):
        SystemNotification.objects.filter(id=first.id).update(target_submission=None)
    with pytest.raises(ValidationError, match="immutable"):
        SystemNotification.objects.filter(id=first.id).delete()


@pytest.mark.django_db
def test_historical_email_delivery_records_remain_when_new_outcomes_use_message_center():
    old_submission = make_complete_submission(email="old@example.com")
    old_event = SubmissionEvent.objects.create(
        submission=old_submission,
        actor=old_submission.submitter,
        revision=1,
        prior_state="pending",
        new_state="rejected",
        reason="تصمیم قدیمی",
    )
    historical = SubmissionDecisionNotification.objects.create(
        decision=old_event,
        status="delivered",
        attempt_count=1,
    )
    new_submission = make_complete_submission(email="new@example.com")
    submit_for_review(submission=new_submission, actor=new_submission.submitter)
    operator = make_operator(email="new-operator@example.com")
    claim_submission_review(submission=new_submission, actor=operator)

    reject_submission(
        submission=new_submission,
        actor=operator,
        reviewed_revision=new_submission.revision,
        reason="تصمیم جدید",
    )

    assert SubmissionDecisionNotification.objects.get() == historical
    assert SystemNotification.objects.get().recipient == new_submission.submitter
