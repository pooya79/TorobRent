"""End Source authority under the same lock used by extraction and publication."""

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User
from apps.catalog.models import Listing, ListingState, Source
from apps.catalog.services import mark_listing_unavailable
from apps.communications.services import create_source_proposal_review_notification

from .discovery_workflow import release_reservations
from .extraction import authorization_error
from .models import (
    ExternalListingCandidateState,
    ExtractionRun,
    ExtractionState,
    SourceAssignment,
    SourceProfile,
    SourceProposal,
    SourceProposalEvent,
    SourceProposalState,
)
from .review_claims import SourceProposalReviewConflict, ensure_independent_reviewer
from .run_review import refresh_run_counts
from .services import record_candidate_transition


@transaction.atomic
def revoke_assignment(
    *, proposal: SourceProposal, actor: User, reviewed_revision: int, reason: str
) -> SourceProposal:
    if not has_capability(actor, OperatorCapability.REVIEW_SOURCE_PROPOSALS):
        raise ValidationError("Source Proposal Review capability is required.")
    # Publications may insert notification foreign keys while holding Source.
    # Serialize proposal mutations without blocking those key-share checks.
    proposal = SourceProposal.objects.select_for_update(no_key=True).get(pk=proposal.pk)
    ensure_independent_reviewer(proposal=proposal, actor=actor)
    reason = reason.strip()
    if not reason:
        raise ValidationError("دلیل لغو تخصیص لازم است.")
    if proposal.revision != reviewed_revision:
        raise SourceProposalReviewConflict("review_revision_conflict", "پیشنهاد تغییر کرده است.")
    assignment = SourceAssignment.objects.filter(proposal=proposal, revoked_at__isnull=True).first()
    if assignment is None:
        raise SourceProposalReviewConflict("assignment_revoked", "تخصیص فعال وجود ندارد.")
    Source.objects.select_for_update().get(pk=assignment.source_id)
    now = timezone.now()
    event = SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=actor,
        revision=proposal.revision,
        prior_state=proposal.state,
        new_state=SourceProposalState.REVOKED,
        reason=reason,
    )
    assignment.revoked_at = now
    assignment.revocation = event
    assignment.save(update_fields=("revoked_at", "revocation"))
    SourceProfile.objects.filter(source=assignment.source).update(active_version=None)
    release_reservations(proposal, "revoked")
    proposal.review_claims.filter(released_at__isnull=True).update(released_at=now)
    proposal.state = SourceProposalState.REVOKED
    proposal.revision += 1
    proposal.pending_since = None
    proposal.save(update_fields=("state", "revision", "pending_since", "updated_at"))

    assignment.requests.exclude(state=ExtractionState.COMPLETE).update(
        state=ExtractionState.CANCELLED, updated_at=now
    )
    runs = ExtractionRun.objects.filter(request__assignment=assignment)
    # Finished failures keep their diagnostic evidence; cancelling the request
    # above also fences any retry delivery for those runs.
    runs.filter(state__in=(ExtractionState.QUEUED, ExtractionState.RUNNING)).update(
        state=ExtractionState.CANCELLED, completed_at=now, errors=[authorization_error()]
    )
    candidates = proposal.external_listing_candidates.all()
    for candidate in candidates.select_for_update().filter(
        state__in=(
            ExternalListingCandidateState.PENDING,
            ExternalListingCandidateState.CHANGES_REQUESTED,
        )
    ):
        record_candidate_transition(
            candidate=candidate,
            actor=actor,
            new_state=ExternalListingCandidateState.CANCELLED,
            reason=reason,
        )
        candidate.review_claims.filter(released_at__isnull=True).update(released_at=now)
    for run in runs:
        refresh_run_counts(run)
    for listing in Listing.objects.select_for_update().filter(
        pk__in=candidates.exclude(listing=None).values("listing_id"), state=ListingState.PUBLISHED
    ):
        mark_listing_unavailable(listing)
    if proposal.submitter_id is not None:
        create_source_proposal_review_notification(event)
    return proposal
