"""Publication grants are scoped to an approval and never extend to older requests."""

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.accounts.models import User
from apps.communications.models import SystemNotification

from .models import (
    ProfileReviewMode,
    SourceAssignment,
    SourceProfileDecision,
    SourceProposal,
    SourceProposalEvent,
    SourcePublicationModeChange,
)
from .responsibility import require_source_responsibility
from .review_claims import SourceProposalReviewConflict


def publication_mode(approval: SourceProfileDecision | None) -> tuple[str, int]:
    if approval is None:
        return "", 0
    change = approval.publication_changes.order_by("-revision").first()
    return (change.review_mode, change.revision) if change else (approval.review_mode, 0)


@transaction.atomic
def change_publication_mode(
    *,
    proposal: SourceProposal,
    actor: User,
    reviewed_profile_version: str,
    reviewed_mode_revision: int,
    review_mode: str,
) -> SourceProposal:
    proposal = SourceProposal.objects.select_for_update(no_key=True).get(pk=proposal.pk)
    source = require_source_responsibility(proposal=proposal, actor=actor)
    assignment = SourceAssignment.objects.filter(proposal=proposal, revoked_at__isnull=True).first()
    if (
        source is None
        or assignment is None
        or assignment.approval is None
        or proposal.state != "approved"
        or source.profile.active_version_id != assignment.approval.version_id
        or str(assignment.approval.version_id) != str(reviewed_profile_version)
    ):
        raise ValidationError("تخصیص فعال و نسخه تأییدشده منبع لازم است.")
    mode, revision = publication_mode(assignment.approval)
    if revision != reviewed_mode_revision:
        raise SourceProposalReviewConflict(
            "publication_mode_conflict", "روش انتشار تغییر کرده است؛ پرونده را تازه کنید."
        )
    if review_mode not in ProfileReviewMode.values or review_mode == mode:
        raise ValidationError("روش انتشار تازه را انتخاب کنید.")
    proposal.revision += 1
    proposal.save(update_fields=("revision", "updated_at"))
    reason = (
        "انتشار خودکار نتایج معتبر فقط برای درخواست‌های تازه فعال شد."
        if review_mode == ProfileReviewMode.AUTOMATIC
        else "انتشار خودکار متوقف شد؛ نتایج در انتظار تأیید اپراتور می‌ماند."
    )
    event = SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=actor,
        revision=proposal.revision,
        prior_state=proposal.state,
        new_state=proposal.state,
        reason=reason,
    )
    SourcePublicationModeChange.objects.create(
        approval=assignment.approval,
        event=event,
        revision=revision + 1,
        review_mode=review_mode,
    )
    if assignment.representative is not None:
        SystemNotification.objects.create(
            recipient=assignment.representative,
            originating_source_proposal_event=event,
            target_source_proposal=proposal,
        )
    return proposal
