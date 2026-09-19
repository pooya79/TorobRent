"""Review a selection with per-item outcomes and one summary per extraction requester."""

from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404

from apps.accounts.models import User
from apps.catalog.models import Source
from apps.communications.models import SystemNotification

from .models import ExternalListingCandidate, ExternalListingCandidateEvent, SourceProposal
from .responsibility import require_source_responsibility
from .review_claims import SourceProposalReviewConflict
from .services import approve_external_listing_candidate, reject_external_listing_candidate


@transaction.atomic
def decide_batch(
    *,
    proposal_id: str,
    actor: User,
    items: list[dict[str, Any]],
    action: str,
    reason: str = "",
    confirmed: bool = False,
) -> dict[str, Any]:
    proposal = get_object_or_404(SourceProposal, pk=proposal_id)
    if proposal.source_id:
        Source.objects.select_for_update().get(pk=proposal.source_id)
    require_source_responsibility(proposal=proposal, actor=actor)
    if action == "approve" and not confirmed:
        raise ValidationError("تأیید انتشار لازم است.")
    ids = [item["id"] for item in items]
    candidates = {
        candidate.pk: candidate
        for candidate in ExternalListingCandidate.objects.filter(
            source_proposal=proposal,
            pk__in=ids,
        )
    }
    if len(candidates) != len(ids):
        raise ValidationError("همه آگهی‌ها باید متفاوت و متعلق به همین منبع باشند.")
    succeeded = []
    failed = []
    notices: dict[UUID, list[ExternalListingCandidateEvent]] = {}
    for item in items:
        candidate = candidates[item["id"]]
        try:
            # Each service has a savepoint: a failed item cannot leave a partial decision.
            if action == "reject":
                candidate = reject_external_listing_candidate(
                    candidate=candidate,
                    actor=actor,
                    reviewed_revision=item["reviewed_revision"],
                    reason=reason,
                    notify=False,
                )
            else:
                candidate = approve_external_listing_candidate(
                    candidate=candidate,
                    actor=actor,
                    reviewed_revision=item["reviewed_revision"],
                    confirmed=confirmed,
                    notify=False,
                )
        except (ValidationError, SourceProposalReviewConflict) as exc:
            failed.append({
                "id": str(candidate.pk),
                "detail": (
                    " ".join(exc.messages) if isinstance(exc, ValidationError) else str(exc)
                ),
            })
            continue
        succeeded.append(str(candidate.pk))
        if candidate.extraction_run and candidate.extraction_run.request.requester_id:
            recipient = candidate.extraction_run.request.requester_id
            notices.setdefault(recipient, []).append(candidate.events.latest("created_at"))
    for recipient, events in notices.items():
        SystemNotification.objects.create(
            recipient_id=recipient,
            originating_candidate_event=events[0],
            candidate_batch_event_ids=[str(event.pk) for event in events],
            target_source_proposal=proposal,
        )
    return {"succeeded": succeeded, "failed": failed}
