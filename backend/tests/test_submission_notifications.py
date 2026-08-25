from unittest.mock import patch

import pytest
from django.core import mail
from django.db import transaction

from apps.submissions.models import SubmissionDecisionNotification
from apps.submissions.services import (
    approve_submission,
    claim_submission_review,
    deliver_decision_notification,
    dispatch_pending_decision_notifications,
    prepare_submission_edit,
    reject_submission,
    request_submission_changes,
    submit_for_review,
)
from apps.submissions.tasks import deliver_submission_decision_notification
from tests.test_submission_review import make_complete_submission, make_operator


@pytest.mark.django_db
def test_request_changes_dispatches_notification_only_after_commit(
    django_capture_on_commit_callbacks,
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)

    with patch("celery.app.task.Task.apply_async") as apply_async:
        with django_capture_on_commit_callbacks(execute=False) as callbacks:
            request_submission_changes(
                submission=submission,
                actor=operator,
                reviewed_revision=submission.revision,
                reason="شماره تماس را اصلاح کنید.",
            )
            notification = SubmissionDecisionNotification.objects.get()
            assert notification.status == "pending"
            apply_async.assert_not_called()

        assert len(callbacks) == 1
        callbacks[0]()
        apply_async.assert_called_once()
    assert apply_async.call_args.args == ((str(notification.id),), {})


@pytest.mark.django_db
@pytest.mark.parametrize("decision", ["reject", "approve"])
def test_other_review_decisions_create_and_dispatch_notifications(
    decision: str,
    django_capture_on_commit_callbacks,
):
    submission = make_complete_submission(email=f"{decision}@example.com")
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator(email=f"{decision}-operator@example.com")
    claim_submission_review(submission=submission, actor=operator)

    with (
        patch("celery.app.task.Task.apply_async") as apply_async,
        django_capture_on_commit_callbacks(execute=True),
    ):
        if decision == "reject":
            reject_submission(
                submission=submission,
                actor=operator,
                reviewed_revision=submission.revision,
                reason="این پیشنهاد قابل انتشار نیست.",
            )
        else:
            approve_submission(
                submission=submission,
                actor=operator,
                reviewed_revision=submission.revision,
            )

    notification = SubmissionDecisionNotification.objects.get()
    assert notification.decision.new_state == ("rejected" if decision == "reject" else "published")
    assert notification.status == "pending"
    assert apply_async.call_count == 1


@pytest.mark.django_db
def test_notification_task_delivers_privately_and_is_idempotent(
    django_capture_on_commit_callbacks,
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)
    sensitive_reason = "شماره محرمانه ۰۹۱۲۱۲۳۴۵۶۷ را اصلاح کنید."
    with django_capture_on_commit_callbacks(execute=False):
        request_submission_changes(
            submission=submission,
            actor=operator,
            reviewed_revision=submission.revision,
            reason=sensitive_reason,
        )
    notification = SubmissionDecisionNotification.objects.get()

    deliver_submission_decision_notification(str(notification.id))
    deliver_submission_decision_notification(str(notification.id))

    notification.refresh_from_db()
    assert notification.status == "delivered"
    assert notification.attempt_count == 1
    assert notification.delivered_at is not None
    assert len(mail.outbox) == 1
    message = mail.outbox[0]
    assert message.to == [submission.submitter.email]
    assert sensitive_reason not in message.subject
    assert sensitive_reason not in message.body
    assert submission.address not in message.subject
    assert submission.address not in message.body
    assert submission.contact_phone not in message.body
    assert message.body.endswith(f"/dashboard#submission-{submission.id}")
    assert message.extra_headers["Message-ID"] == (
        f"<submission-decision-{notification.id}@torobrent.local>"
    )


@pytest.mark.django_db
def test_submitter_can_inspect_delivery_state_without_notification_content(
    api_client,
    django_capture_on_commit_callbacks,
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)
    with django_capture_on_commit_callbacks(execute=False):
        reject_submission(
            submission=submission,
            actor=operator,
            reviewed_revision=submission.revision,
            reason="جزئیات خصوصی بررسی",
        )

    api_client.force_authenticate(submission.submitter)
    response = api_client.get("/api/v1/submissions/")

    assert response.status_code == 200
    notification = response.data[0]["notification"]
    assert notification["status"] == "pending"
    assert notification["attempt_count"] == 0
    assert notification["delivered_at"] is None
    assert notification["failure_reason"] is None
    assert set(notification) == {
        "id",
        "status",
        "attempt_count",
        "failure_reason",
        "delivered_at",
        "updated_at",
    }


@pytest.mark.django_db
def test_failed_approval_email_is_independent_and_reviewer_can_retry(
    api_client,
    django_capture_on_commit_callbacks,
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    reviewer = make_operator()
    claim_submission_review(submission=submission, actor=reviewer)
    with django_capture_on_commit_callbacks(execute=False):
        approve_submission(
            submission=submission,
            actor=reviewer,
            reviewed_revision=submission.revision,
        )
    notification = SubmissionDecisionNotification.objects.get()

    with (
        patch(
            "apps.submissions.services.EmailMessage.send",
            side_effect=OSError("mail unavailable"),
        ),
        pytest.raises(OSError, match="mail unavailable"),
    ):
        deliver_decision_notification(str(notification.id))

    submission.refresh_from_db()
    notification.refresh_from_db()
    assert submission.state == "published"
    assert submission.listing_id is not None
    assert submission.events.count() == 2
    assert notification.status == "failed"
    assert notification.attempt_count == 1

    unrelated_operator = make_operator(email="unrelated@example.com", permitted=False)
    api_client.force_authenticate(unrelated_operator)
    retry_url = (
        f"/api/v1/operator/submissions/{submission.id}/notifications/{notification.id}/retry/"
    )
    assert api_client.post(retry_url, {}, format="json").status_code == 403

    api_client.force_authenticate(reviewer)
    with (
        patch("celery.app.task.Task.apply_async") as apply_async,
        django_capture_on_commit_callbacks(execute=True),
    ):
        retried = api_client.post(retry_url, {}, format="json")

    notification.refresh_from_db()
    assert retried.status_code == 200
    assert retried.data["notification"]["status"] == "pending"
    decision = next(
        event for event in retried.data["history"] if event["id"] == str(notification.decision_id)
    )
    assert decision["notification"]["status"] == "pending"
    assert notification.status == "pending"
    assert submission.events.count() == 2
    assert apply_async.call_count == 1


@pytest.mark.django_db
def test_rolled_back_decision_creates_no_notification_or_dispatch(
    django_capture_on_commit_callbacks,
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    reviewer = make_operator()
    claim_submission_review(submission=submission, actor=reviewer)

    with (
        patch("celery.app.task.Task.apply_async") as apply_async,
        django_capture_on_commit_callbacks(execute=True),
        pytest.raises(RuntimeError, match="roll back"),
        transaction.atomic(),
    ):
        reject_submission(
            submission=submission,
            actor=reviewer,
            reviewed_revision=submission.revision,
            reason="رد نهایی",
        )
        raise RuntimeError("roll back")

    submission.refresh_from_db()
    assert submission.state == "pending"
    assert submission.events.count() == 1
    assert not SubmissionDecisionNotification.objects.exists()
    apply_async.assert_not_called()


@pytest.mark.django_db
def test_notification_task_retries_a_transient_mail_failure(
    django_capture_on_commit_callbacks,
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    reviewer = make_operator()
    claim_submission_review(submission=submission, actor=reviewer)
    with django_capture_on_commit_callbacks(execute=False):
        reject_submission(
            submission=submission,
            actor=reviewer,
            reviewed_revision=submission.revision,
            reason="رد نهایی",
        )
    notification = SubmissionDecisionNotification.objects.get()

    with patch(
        "apps.submissions.services.EmailMessage.send",
        side_effect=[OSError("temporary mail outage"), 1],
    ) as send:
        result = deliver_submission_decision_notification.apply(
            args=(str(notification.id),),
            throw=False,
        )

    notification.refresh_from_db()
    assert result.successful()
    assert send.call_count == 2
    assert notification.status == "delivered"
    assert notification.attempt_count == 2


@pytest.mark.django_db
def test_broker_failure_is_visible_and_pending_rows_are_recovered(
    django_capture_on_commit_callbacks,
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    reviewer = make_operator()
    claim_submission_review(submission=submission, actor=reviewer)
    with django_capture_on_commit_callbacks(execute=False) as callbacks:
        reject_submission(
            submission=submission,
            actor=reviewer,
            reviewed_revision=submission.revision,
            reason="رد نهایی",
        )
    notification = SubmissionDecisionNotification.objects.get()

    with patch(
        "celery.app.task.Task.apply_async",
        side_effect=OSError("broker unavailable"),
    ):
        callbacks[0]()

    notification.refresh_from_db()
    assert notification.status == "failed"
    assert notification.failure_kind == "dispatch_failed"

    notification.status = "pending"
    notification.failure_kind = ""
    notification.save(update_fields=("status", "failure_kind", "updated_at"))
    with patch("celery.app.task.Task.apply_async") as apply_async:
        assert dispatch_pending_decision_notifications() == 1
    assert apply_async.call_count == 1


@pytest.mark.django_db
def test_reviewer_can_inspect_and_retry_an_older_failed_notification(
    api_client,
    django_capture_on_commit_callbacks,
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    reviewer = make_operator()
    claim_submission_review(submission=submission, actor=reviewer)
    with django_capture_on_commit_callbacks(execute=False):
        request_submission_changes(
            submission=submission,
            actor=reviewer,
            reviewed_revision=submission.revision,
            reason="اصلاح لازم است.",
        )
    older = SubmissionDecisionNotification.objects.get()
    older.status = "failed"
    older.failure_kind = "delivery_failed"
    older.save(update_fields=("status", "failure_kind", "updated_at"))

    prepare_submission_edit(submission=submission, actor=submission.submitter)
    submission.refresh_from_db()
    submission.review_data = {"accuracy_confirmed": True}
    submission.save(update_fields=("review_data", "updated_at"))
    submit_for_review(submission=submission, actor=submission.submitter)
    claim_submission_review(submission=submission, actor=reviewer)
    with django_capture_on_commit_callbacks(execute=False):
        reject_submission(
            submission=submission,
            actor=reviewer,
            reviewed_revision=submission.revision,
            reason="رد نهایی",
        )
    newer = SubmissionDecisionNotification.objects.exclude(id=older.id).get()

    api_client.force_authenticate(reviewer)
    detail = api_client.get(f"/api/v1/operator/submissions/{submission.id}/")
    notifications = [
        event["notification"] for event in detail.data["history"] if event["notification"]
    ]
    assert {item["id"] for item in notifications} == {str(older.id), str(newer.id)}
    retry_url = f"/api/v1/operator/submissions/{submission.id}/notifications/{older.id}/retry/"
    with django_capture_on_commit_callbacks(execute=False):
        retried = api_client.post(retry_url, {}, format="json")

    older.refresh_from_db()
    newer.refresh_from_db()
    assert retried.status_code == 200
    assert older.status == "pending"
    assert newer.status == "pending"
