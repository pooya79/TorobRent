from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.accounts.models import User

from .models import SourceProposal, SourceProposalReviewClaim, SourceProposalState


class SourceProposalReviewConflict(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def active_review_claim(proposal: SourceProposal) -> SourceProposalReviewClaim | None:
    return proposal.review_claims.filter(released_at__isnull=True).first()


def ensure_independent_reviewer(*, proposal: SourceProposal, actor: User) -> None:
    if proposal.submitter_id == actor.id:
        raise ValidationError("An Operator cannot decide their own Source Proposal.")


def require_review_claim(
    *, proposal: SourceProposal, actor: User, reviewed_revision: int
) -> SourceProposalReviewClaim:
    if proposal.revision != reviewed_revision:
        raise SourceProposalReviewConflict(
            "review_revision_conflict", "The Source Proposal revision changed. Refresh it."
        )
    if proposal.state != SourceProposalState.PENDING:
        raise SourceProposalReviewConflict(
            "review_decision_conflict", "Another decision already changed this Source Proposal."
        )
    claim = active_review_claim(proposal)
    if claim is None or claim.operator_id != actor.id:
        raise SourceProposalReviewConflict(
            "review_claim_required", "A current Review Claim owned by this Operator is required."
        )
    if claim.revision != reviewed_revision:
        raise SourceProposalReviewConflict(
            "review_revision_conflict", "The Source Proposal revision changed. Refresh it."
        )
    if claim.expires_at <= timezone.now():
        claim.released_at = timezone.now()
        claim.save(update_fields=("released_at",))
        raise SourceProposalReviewConflict("review_claim_expired", "The Review Claim expired.")
    return claim
