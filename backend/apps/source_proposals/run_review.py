"""Revision-checked approval at the existing Source case boundary."""

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Source

from .candidate_publication import publish_candidate, validation_errors
from .extraction import authorized
from .models import (
    ExternalListingCandidateState,
    ExtractionRun,
    ExtractionRunDecision,
    ExtractionState,
    ProfileReviewMode,
)
from .review_claims import SourceProposalReviewConflict
from .services import record_candidate_transition


@transaction.atomic
def approve_run(
    *, run: ExtractionRun, actor: User, reviewed_revision: int, confirmed: bool
) -> ExtractionRun:
    Source.objects.select_for_update().get(pk=run.request.assignment.source_id)
    run = ExtractionRun.objects.select_for_update().get(pk=run.pk)
    approval = run.request.assignment.approval
    if (
        not authorized(run.request)
        or not approval
        or approval.review_mode != ProfileReviewMode.APPROVAL_REQUIRED
    ):
        raise ValidationError("تخصیص یا پروفایل فعال و نیازمند تأیید لازم است.")
    if actor.pk != approval.event.actor_id or actor.pk == run.request.requester_id:
        raise ValidationError("فقط اپراتور مسئول منبع می‌تواند نتایج را تأیید کند.")
    if not confirmed:
        raise ValidationError("تأیید انتشار لازم است.")
    if run.revision != reviewed_revision or run.state != ExtractionState.COMPLETE:
        raise SourceProposalReviewConflict(
            "review_revision_conflict", "نتایج تغییر کرده است؛ دوباره بارگیری کنید."
        )
    published = []
    for candidate in run.candidates.select_for_update().filter(
        state=ExternalListingCandidateState.PENDING
    ):
        errors = validation_errors(candidate)
        candidate.validation_errors = errors
        candidate.save(update_fields=("validation_errors",))
        if errors:
            continue
        claim = candidate.review_claims.filter(
            released_at__isnull=True, expires_at__gt=timezone.now()
        ).first()
        if claim and claim.operator_id != actor.pk:
            raise SourceProposalReviewConflict(
                "review_claim_conflict", "نتیجه در اختیار اپراتور دیگری است."
            )
        publish_candidate(candidate)
        record_candidate_transition(
            candidate=candidate, actor=actor, new_state=ExternalListingCandidateState.PUBLISHED
        )
        candidate.review_claims.filter(released_at__isnull=True).update(released_at=timezone.now())
        published.append(str(candidate.pk))
    if not published:
        raise SourceProposalReviewConflict(
            "review_decision_conflict", "نتیجه معتبر در انتظار انتشار وجود ندارد."
        )
    decision = ExtractionRunDecision.objects.create(
        run=run, actor=actor, revision=run.revision, candidate_ids=published
    )
    from apps.communications.models import SystemNotification

    if run.request.requester is not None:
        SystemNotification.objects.create(
            recipient=run.request.requester,
            originating_run_decision=decision,
            target_source_proposal=run.request.assignment.proposal,
        )
    refresh_run_counts(run)
    return run


def refresh_run_counts(run: ExtractionRun) -> None:
    run.published = run.candidates.filter(state="published").count()
    run.needs_attention = (
        run.candidates
        .filter(state__in=("pending", "changes_requested"))
        .exclude(validation_errors={})
        .count()
    )
    # Preserve Discovery rejection counts separately from candidate decisions.
    run.rejected += run.candidates.filter(state="rejected").count() - run.candidate_rejected
    run.candidate_rejected = run.candidates.filter(state="rejected").count()
    run.revision += 1
    run.save()
