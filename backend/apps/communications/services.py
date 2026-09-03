from apps.submissions.models import SubmissionEvent

from .models import SystemNotification


def create_submission_review_notification(decision: SubmissionEvent) -> SystemNotification:
    notification, _ = SystemNotification.objects.get_or_create(
        recipient=decision.submission.submitter,
        originating_event=decision,
        defaults={"target_submission": decision.submission},
    )
    return notification
