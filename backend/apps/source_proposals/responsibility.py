"""Current Source decision authority and append-only reassignment evidence."""

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User
from apps.catalog.models import Source

from .models import SourceAssignment, SourceProposal, SourceResponsibilityChange
from .review_claims import SourceProposalReviewConflict, ensure_independent_reviewer


def record_responsibility(*, source: Source, operator: User, actor: User, reason: str) -> None:
    source.responsible_operator = operator
    source.responsibility_revision += 1
    source.save(update_fields=("responsible_operator", "responsibility_revision"))
    SourceResponsibilityChange.objects.create(
        source=source,
        operator=operator,
        actor=actor,
        revision=source.responsibility_revision,
        reason=reason,
    )


@transaction.atomic
def reassign_responsibility(
    *,
    proposal: SourceProposal,
    actor: User,
    assignee_email: str,
    reviewed_responsibility_revision: int,
    reason: str,
) -> SourceProposal:
    proposal = SourceProposal.objects.select_for_update(no_key=True).get(pk=proposal.pk)
    source = (
        Source.objects.select_for_update().filter(pk=proposal.source_id).first()
        if proposal.source_id
        else None
    )
    actor = User.objects.get(pk=actor.pk)
    if not has_capability(actor, OperatorCapability.MANAGE_OPERATOR_QUEUES):
        raise ValidationError("مدیریت صف اپراتورها لازم است.")
    ensure_independent_reviewer(proposal=proposal, actor=actor)
    if (
        source is None
        or not SourceAssignment.objects.filter(proposal=proposal, revoked_at__isnull=True).exists()
    ):
        raise ValidationError("تخصیص فعال منبع لازم است.")
    if source.responsibility_revision != reviewed_responsibility_revision:
        raise SourceProposalReviewConflict(
            "responsibility_conflict", "مسئول منبع تغییر کرده است؛ پرونده را تازه کنید."
        )
    operator = User.objects.filter(email__iexact=assignee_email).first()
    if operator is None or not has_capability(operator, OperatorCapability.REVIEW_SOURCE_PROPOSALS):
        raise ValidationError("اپراتور مقصد باید اختیار بررسی منبع داشته باشد.")
    ensure_independent_reviewer(proposal=proposal, actor=operator)
    if source.responsible_operator_id == operator.pk or not reason.strip():
        raise ValidationError("مسئول تازه و دلیل تغییر لازم است.")
    record_responsibility(source=source, operator=operator, actor=actor, reason=reason.strip())
    # Transfer ends existing leases without deleting their historical evidence.
    from .models import ExternalListingCandidateReviewClaim

    now = timezone.now()
    proposal.review_claims.filter(released_at__isnull=True).update(released_at=now)
    ExternalListingCandidateReviewClaim.objects.filter(
        candidate__source_proposal=proposal, released_at__isnull=True
    ).update(released_at=now)
    return proposal


def require_source_responsibility(*, proposal: SourceProposal, actor: User) -> Source | None:
    """Caller holds proposal or Source lock; initial onboarding still uses Review Claims."""
    source = (
        Source.objects.select_for_update().get(pk=proposal.source_id)
        if proposal.source_id
        else None
    )
    actor = User.objects.get(pk=actor.pk)
    if not has_capability(actor, OperatorCapability.REVIEW_SOURCE_PROPOSALS):
        raise ValidationError("اختیار بررسی منبع لازم است.")
    ensure_independent_reviewer(proposal=proposal, actor=actor)
    if SourceAssignment.objects.filter(proposal=proposal, revoked_at__isnull=True).exists() and (
        source is None or source.responsible_operator_id != actor.pk
    ):
        raise ValidationError("ابتدا مسئولیت منبع باید به شما واگذار شود.")
    return source


def require_source_image_host_authority(*, source: Source, actor: User) -> None:
    """The admin save transaction holds these locks until its host decision is saved."""
    from .models import SourceProposalState, SourceReservation
    from .review_claims import require_review_claim

    assignment = SourceAssignment.objects.filter(source=source, revoked_at__isnull=True).first()
    reservation = SourceReservation.objects.filter(source=source, released_at__isnull=True).first()
    case = assignment or reservation
    if case is None:
        raise ValidationError("تخصیص یا بررسی فعال منبع لازم است.")
    proposal = SourceProposal.objects.select_for_update(no_key=True).get(pk=case.proposal_id)
    require_source_responsibility(proposal=proposal, actor=actor)
    if proposal.state == SourceProposalState.PENDING:
        require_review_claim(proposal=proposal, actor=actor, reviewed_revision=proposal.revision)
    elif proposal.state != SourceProposalState.APPROVED or assignment is None:
        raise ValidationError("تخصیص یا بررسی فعال منبع لازم است.")
