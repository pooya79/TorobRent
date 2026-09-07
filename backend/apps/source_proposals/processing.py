"""Explicit Source processing transitions, serialized with extraction publication."""

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.accounts.models import User
from apps.catalog.models import Source
from apps.communications.models import SystemNotification

from .models import (
    ExternalListingCandidate,
    ProfileReviewMode,
    SourceAssignment,
    SourceProposal,
    SourceProposalEvent,
    SourcePublicationModeChange,
)
from .publication_modes import publication_mode
from .responsibility import require_source_responsibility
from .review_claims import SourceProposalReviewConflict


@transaction.atomic
def change_processing(
    *,
    proposal: SourceProposal,
    actor: User,
    action: str,
    reviewed_processing_revision: int,
    review_mode: str = "",
) -> SourceProposal:
    proposal = SourceProposal.objects.select_for_update(no_key=True).get(pk=proposal.pk)
    source = require_source_responsibility(proposal=proposal, actor=actor)
    assignment = SourceAssignment.objects.filter(proposal=proposal, revoked_at__isnull=True).first()
    if source is None or assignment is None or assignment.approval is None:
        raise ValidationError("تخصیص و پروفایل فعال منبع لازم است.")
    if source.processing_revision != reviewed_processing_revision:
        raise SourceProposalReviewConflict("processing_conflict", "وضعیت منبع تغییر کرده است.")
    if action not in ("pause", "resume") or source.processing_paused == (action == "pause"):
        raise ValidationError("تغییر وضعیت معتبر نیست.")
    if action == "resume" and review_mode not in ProfileReviewMode.values:
        raise ValidationError("روش انتشار را برای استخراج تازه انتخاب کنید.")
    if source.profile.active_version_id != assignment.approval.version_id:
        raise ValidationError("پروفایل فعال لازم است.")
    source.processing_paused = action == "pause"
    source.save(update_fields=("processing_paused",))
    advance_processing_revision(source)
    event = SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=actor,
        revision=proposal.revision,
        processing_action=action,
        prior_state=proposal.state,
        new_state=proposal.state,
        reason="پردازش منبع متوقف شد" if action == "pause" else "پردازش منبع از سر گرفته شد",
    )
    if assignment.representative is not None:
        SystemNotification.objects.create(
            recipient=assignment.representative,
            originating_source_proposal_event=event,
            target_source_proposal=proposal,
        )
    if action == "resume":
        _, revision = publication_mode(assignment.approval)
        SourcePublicationModeChange.objects.create(
            approval=assignment.approval,
            event=event,
            revision=revision + 1,
            review_mode=review_mode,
        )
        start_fresh_extraction(assignment=assignment, actor=actor)
    return proposal


def start_fresh_extraction(*, assignment: SourceAssignment, actor: User) -> None:
    """Start a new bounded fetch from the approved website, never retained HTML."""
    from .extraction import submit_request

    if assignment.representative is None:
        raise ValidationError("نماینده فعال منبع لازم است.")
    submit_request(
        assignment_id=assignment.pk,
        proposal_id=str(assignment.proposal_id),
        actor=assignment.representative,
        initiated_by=actor,
        url=assignment.proposal.website_url,
    )


def advance_processing_revision(source: Source) -> None:
    """Caller holds the Source lock; legacy candidates have no request revision."""
    source.processing_revision += 1
    source.save(update_fields=("processing_revision",))
    ExternalListingCandidate.objects.filter(
        source=source,
        extraction_run__isnull=True,
        discovery_version__isnull=True,
        state__in=("pending", "changes_requested"),
    ).update(superseded=True)
