"""Current Source decision authority and append-only reassignment evidence."""

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User
from apps.catalog.models import Source

from .models import (
    SourceAssignment,
    SourceCaseResponsibilityChange,
    SourceProposal,
    SourceResponsibilityChange,
)
from .review_claims import SourceProposalReviewConflict, ensure_independent_reviewer


def record_case_responsibility(
    *, proposal: SourceProposal, operator: User, actor: User, reason: str
) -> None:
    proposal.responsible_operator = operator
    proposal.responsibility_revision += 1
    proposal.save(update_fields=("responsible_operator", "responsibility_revision"))
    SourceCaseResponsibilityChange.objects.create(
        proposal=proposal,
        operator=operator,
        actor=actor,
        revision=proposal.responsibility_revision,
        reason=reason,
    )
    if (
        proposal.source_id
        and SourceAssignment.objects.filter(proposal=proposal, revoked_at__isnull=True).exists()
    ):
        source = Source.objects.select_for_update().get(pk=proposal.source_id)
        record_responsibility(source=source, operator=operator, actor=actor, reason=reason)


@transaction.atomic
def take_responsibility(*, proposal: SourceProposal, actor: User) -> SourceProposal:
    proposal = SourceProposal.objects.select_for_update(no_key=True).get(pk=proposal.pk)
    actor = User.objects.get(pk=actor.pk)
    if not has_capability(actor, OperatorCapability.REVIEW_SOURCE_PROPOSALS):
        raise ValidationError("اختیار بررسی منبع لازم است.")
    ensure_independent_reviewer(proposal=proposal, actor=actor)
    if proposal.discarded_at is not None or not (
        proposal.state in ("pending", "changes_requested", "approved")
        or (proposal.state == "draft" and proposal.revision > 1)
        or SourceAssignment.objects.filter(proposal=proposal, revoked_at__isnull=True).exists()
    ):
        raise ValidationError("این پرونده قابل پذیرش نیست.")
    if proposal.responsible_operator_id == actor.pk:
        return proposal
    if proposal.responsible_operator_id is not None:
        raise SourceProposalReviewConflict(
            "responsibility_conflict", "این پرونده مسئول دارد؛ صف را تازه کنید."
        )
    record_case_responsibility(
        proposal=proposal, operator=actor, actor=actor, reason="پذیرش مسئولیت پرونده از صف منابع"
    )
    return proposal


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
    actor = User.objects.get(pk=actor.pk)
    if not has_capability(actor, OperatorCapability.MANAGE_OPERATOR_QUEUES):
        raise ValidationError("مدیریت صف اپراتورها لازم است.")
    ensure_independent_reviewer(proposal=proposal, actor=actor)
    if proposal.discarded_at is not None or (
        (
            proposal.state in ("rejected", "revoked")
            or (proposal.state == "draft" and proposal.revision == 1)
        )
        and not SourceAssignment.objects.filter(proposal=proposal, revoked_at__isnull=True).exists()
    ):
        raise ValidationError("پرونده جاری لازم است.")
    if proposal.responsibility_revision != reviewed_responsibility_revision:
        raise SourceProposalReviewConflict(
            "responsibility_conflict", "مسئول منبع تغییر کرده است؛ پرونده را تازه کنید."
        )
    operator = User.objects.filter(email__iexact=assignee_email).first()
    if operator is None or not has_capability(operator, OperatorCapability.REVIEW_SOURCE_PROPOSALS):
        raise ValidationError("اپراتور مقصد باید اختیار بررسی منبع داشته باشد.")
    ensure_independent_reviewer(proposal=proposal, actor=operator)
    if proposal.responsible_operator_id == operator.pk or not reason.strip():
        raise ValidationError("مسئول تازه و دلیل تغییر لازم است.")
    record_case_responsibility(
        proposal=proposal, operator=operator, actor=actor, reason=reason.strip()
    )
    # Transfer ends existing leases without deleting their historical evidence.
    from .models import ExternalListingCandidateReviewClaim

    now = timezone.now()
    proposal.review_claims.filter(released_at__isnull=True).update(released_at=now)
    ExternalListingCandidateReviewClaim.objects.filter(
        candidate__source_proposal=proposal, released_at__isnull=True
    ).update(released_at=now)
    return proposal


def require_source_responsibility(*, proposal: SourceProposal, actor: User) -> Source | None:
    """Recheck current ownership after the caller's proposal or Source serialization lock."""
    source = (
        Source.objects.select_for_update().get(pk=proposal.source_id)
        if proposal.source_id
        else None
    )
    # Some callers load the proposal before waiting for Source. A transfer may
    # have committed in between; never authorize using that earlier snapshot.
    proposal.refresh_from_db(fields=("responsible_operator", "responsibility_revision"))
    actor = User.objects.get(pk=actor.pk)
    if not has_capability(actor, OperatorCapability.REVIEW_SOURCE_PROPOSALS):
        raise ValidationError("اختیار بررسی منبع لازم است.")
    ensure_independent_reviewer(proposal=proposal, actor=actor)
    if proposal.responsible_operator_id != actor.pk:
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
