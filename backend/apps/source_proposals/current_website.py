"""A Submitter's current website spans open proposals and active assignments."""

from uuid import UUID

from django.core.exceptions import ValidationError
from django.db.models import Q, QuerySet

from apps.accounts.models import User

from .models import SourceAssignment, SourceProposal, SourceProposalState

CONFLICT_MESSAGE = (
    "بیش از یک وب‌سایت جاری دارید. برای رفع تعارض با اپراتور در گفتگوی منبع هماهنگ کنید؛ "
    "پیشنهادهای اضافی باید بسته و تخصیص‌های اضافی با تصمیم صریح لغو شوند."
)


def current_website_cases(submitter_id: UUID) -> QuerySet[SourceProposal]:
    assignments = SourceAssignment.objects.filter(
        representative_id=submitter_id, revoked_at__isnull=True
    ).values("proposal_id")
    return SourceProposal.objects.filter(
        Q(pk__in=assignments)
        | Q(
            submitter_id=submitter_id,
            discarded_at__isnull=True,
            state__in=(
                SourceProposalState.DRAFT,
                SourceProposalState.PENDING,
                SourceProposalState.CHANGES_REQUESTED,
            ),
        )
    )


def lock_current_website(proposal: SourceProposal) -> None:
    """Call before locking the proposal, inside its mutation transaction.

    A non-key account lock serializes introductions and approvals without blocking
    foreign-key references inserted by discovery, notifications, or publication.
    Legacy conflicts stay intact and can still be discarded, rejected, or revoked.
    """
    if proposal.submitter_id is None:
        return
    User.objects.select_for_update(no_key=True).get(pk=proposal.submitter_id)
    if current_website_cases(proposal.submitter_id).exclude(pk=proposal.pk).exists():
        raise ValidationError(CONFLICT_MESSAGE)
