from unittest.mock import patch

import pytest
from django.core import mail
from django.core.exceptions import ValidationError

from apps.submissions.models import Submission, SubmissionDecisionNotification
from apps.submissions.services import (
    approve_submission,
    claim_submission_review,
    deliver_decision_notification,
    dispatch_pending_decision_notifications,
    reject_submission,
    retry_submission_decision_notification,
    submit_for_review,
)
from apps.submissions.tasks import deliver_submission_decision_notification
from tests.test_submission_review import make_complete_submission, make_operator


def historical_email_record(submission: Submission) -> SubmissionDecisionNotification:
    decision = submission.events.exclude(new_state="pending").latest("created_at")
    return SubmissionDecisionNotification.objects.create(decision=decision)


@pytest.mark.django_db
def test_historical_notification_task_delivers_privately_and_is_idempotent():
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)
    sensitive_reason = "شماره محرمانه ۰۹۱۲۱۲۳۴۵۶۷ را اصلاح کنید."
    reject_submission(
        submission=submission,
        actor=operator,
        reviewed_revision=submission.revision,
        reason=sensitive_reason,
    )
    notification = historical_email_record(submission)

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
def test_submitter_can_still_inspect_historical_delivery_state(api_client):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    operator = make_operator()
    claim_submission_review(submission=submission, actor=operator)
    reject_submission(
        submission=submission,
        actor=operator,
        reviewed_revision=submission.revision,
        reason="جزئیات خصوصی بررسی",
    )
    historical_email_record(submission)
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
def test_failed_historical_email_is_independent_and_reviewer_can_retry(
    api_client,
    django_capture_on_commit_callbacks,
):
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    reviewer = make_operator()
    claim_submission_review(submission=submission, actor=reviewer)
    approve_submission(
        submission=submission,
        actor=reviewer,
        reviewed_revision=submission.revision,
    )
    notification = historical_email_record(submission)

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
    assert notification.status == "failed"

    unrelated_operator = make_operator(email="unrelated@example.com", permitted=False)
    with pytest.raises(ValidationError, match="Reviewer"):
        retry_submission_decision_notification(
            submission=submission,
            notification_id=notification.id,
            actor=unrelated_operator,
        )

    api_client.force_authenticate(reviewer)
    retry_url = (
        f"/api/v1/operator/submissions/{submission.id}/notifications/{notification.id}/retry/"
    )
    with (
        patch("celery.app.task.Task.apply_async") as apply_async,
        django_capture_on_commit_callbacks(execute=True),
    ):
        retried = api_client.post(retry_url, {}, format="json")

    notification.refresh_from_db()
    assert retried.status_code == 200
    assert notification.status == "pending"
    assert apply_async.call_count == 1


@pytest.mark.django_db
def test_historical_notification_task_retries_a_transient_mail_failure():
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    reviewer = make_operator()
    claim_submission_review(submission=submission, actor=reviewer)
    reject_submission(
        submission=submission,
        actor=reviewer,
        reviewed_revision=submission.revision,
        reason="رد نهایی",
    )
    notification = historical_email_record(submission)

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
def test_pending_historical_email_rows_are_recovered():
    submission = make_complete_submission()
    submit_for_review(submission=submission, actor=submission.submitter)
    reviewer = make_operator()
    claim_submission_review(submission=submission, actor=reviewer)
    reject_submission(
        submission=submission,
        actor=reviewer,
        reviewed_revision=submission.revision,
        reason="رد نهایی",
    )
    notification = historical_email_record(submission)

    with patch(
        "celery.app.task.Task.apply_async",
        side_effect=OSError("broker unavailable"),
    ):
        assert dispatch_pending_decision_notifications() == 1

    notification.refresh_from_db()
    assert notification.status == "failed"
    assert notification.failure_kind == "dispatch_failed"

    with patch("celery.app.task.Task.apply_async") as apply_async:
        assert dispatch_pending_decision_notifications() == 1
    assert apply_async.call_count == 1
