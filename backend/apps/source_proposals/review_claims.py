from django.core.exceptions import ValidationError

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
    from .responsibility import require_source_responsibility

    require_source_responsibility(proposal=proposal, actor=actor)
    if proposal.revision != reviewed_revision:
        raise SourceProposalReviewConflict(
            "review_revision_conflict", "The Source Proposal revision changed. Refresh it."
        )
    if proposal.state != SourceProposalState.PENDING:
        raise SourceProposalReviewConflict(
            "review_decision_conflict", "Another decision already changed this Source Proposal."
        )
    # Ownership is durable; the lease remains internal decision evidence.
    from .services import claim_source_proposal_review

    return claim_source_proposal_review(proposal=proposal, actor=actor)
