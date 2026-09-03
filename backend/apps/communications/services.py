from apps.source_proposals.models import SourceProposalEvent, SourceProposalState
from apps.submissions.models import SubmissionEvent

from .models import SystemNotification


def create_submission_review_notification(decision: SubmissionEvent) -> SystemNotification:
    notification, _ = SystemNotification.objects.get_or_create(
        recipient=decision.submission.submitter,
        originating_event=decision,
        defaults={"target_submission": decision.submission},
    )
    return notification


def create_source_proposal_review_notification(
    decision: SourceProposalEvent,
) -> SystemNotification | None:
    if decision.new_state not in (
        SourceProposalState.CHANGES_REQUESTED,
        SourceProposalState.REJECTED,
        SourceProposalState.APPROVED,
    ):
        return None
    notification, _ = SystemNotification.objects.get_or_create(
        recipient=decision.proposal.submitter,
        originating_source_proposal_event=decision,
        defaults={"target_source_proposal": decision.proposal},
    )
    return notification
