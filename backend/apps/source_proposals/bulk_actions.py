"""Explicit, preview-bound decisions over current pages of one Source."""

import hashlib
import json
from typing import Any

from django.core import signing
from django.core.exceptions import ValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone

from apps.accounts.models import User
from apps.communications.source_conversations import open_source_conversation, send_source_message

from .candidate_publication import publish_candidate, validation_errors
from .exclusions import add_exclusion, blocking_exclusion, matching_exclusion, preview_matches
from .extraction import authorized
from .models import (
    ExternalListingCandidate,
    ExternalListingCandidateState,
    ExtractionRun,
    SourceAssignment,
    SourceBulkAction,
    SourceExtractionException,
    SourceProposal,
)
from .publication_modes import publication_mode
from .responsibility import require_source_responsibility
from .review_claims import SourceProposalReviewConflict
from .run_review import refresh_run_counts
from .serializers import ExternalListingCandidateSerializer
from .services import record_candidate_transition

SALT = "source-bulk-preview"


def conflict() -> SourceProposalReviewConflict:
    return SourceProposalReviewConflict(
        "bulk_preview_conflict", "انتخاب یا وضعیت منبع تغییر کرده است؛ پیش‌نمایش را تازه کنید."
    )


def scope(proposal_id: str, actor: User) -> SourceAssignment:
    proposal = get_object_or_404(
        SourceProposal.objects.select_for_update(no_key=True), pk=proposal_id
    )
    source = require_source_responsibility(proposal=proposal, actor=actor)
    assignment = SourceAssignment.objects.filter(
        proposal=proposal, source=source, revoked_at__isnull=True
    ).first()
    if assignment is None:
        raise ValidationError("تخصیص فعال منبع لازم است.")
    return assignment


def snapshot(
    assignment: SourceAssignment, actor: User, ids: list[str], action: str
) -> dict[str, Any]:
    source = assignment.source
    pages = list(SourceExtractionException.objects.filter(source=source, pk__in=ids))
    if len(pages) != len(ids) or len(set(ids)) != len(ids):
        raise ValidationError("همه صفحه‌های انتخابی باید متعلق به همین منبع باشند.")
    items = []
    for page in pages:
        candidate = ExternalListingCandidate.objects.filter(
            source=source,
            extraction_run=page.last_run,
            external_url=page.canonical_url,
            discovery_version__isnull=True,
        ).first()
        rule = (
            blocking_exclusion(candidate)
            if candidate
            else matching_exclusion(source, page.canonical_url)
        )
        status, detail = "blocked", "این صفحه نتیجه قابل انتشار ندارد."
        claims = []
        errors = validation_errors(candidate) if candidate else {}
        if candidate:
            assert candidate.extraction_run is not None
            claims = list(
                candidate.review_claims.filter(
                    released_at__isnull=True, expires_at__gt=timezone.now()
                ).values_list("operator_id", flat=True)
            )
            if candidate.superseded or candidate.state != "pending":
                status, detail = "obsolete", "این نتیجه دیگر در انتظار انتشار نیست."
            elif rule:
                status, detail = "excluded", rule.reason
            elif not authorized(candidate.extraction_run.request):
                detail = "پردازش متوقف است یا مجوز نتیجه پایان یافته است."
            elif candidate.extraction_run.state != "complete":
                detail = "استخراج هنوز پایان نیافته است."
            elif candidate.extraction_run.request.requester_id == actor.pk:
                detail = "بررسی مستقل لازم است."
            elif any(owner != actor.pk for owner in claims):
                detail = "نتیجه در اختیار اپراتور دیگری است."
            elif errors:
                detail = "اطلاعات الزامی نیازمند اصلاح است."
            else:
                status, detail = "eligible", "آماده انتشار"
        elif rule:
            status, detail = "excluded", rule.reason
        impact = (
            preview_matches(source=source, kind="exact", url=page.canonical_url)
            if action == "exclude"
            else {}
        )
        action_eligible = status == "eligible"
        if action == "exclude":
            action_eligible = matching_exclusion(source, page.canonical_url) is None
        if action == "request_action":
            action_eligible = (
                assignment.representative_id is not None
                and assignment.proposal.submitter_id is not None
            )
        if candidate and candidate.superseded:
            action_eligible = False
        items.append({
            "id": str(page.pk),
            "url": page.canonical_url,
            "status": status,
            "detail": detail,
            "action_eligible": action_eligible,
            "published_listing_count": impact.get("published_listing_count", 0),
            "published_listings": impact.get("published_listings", []),
            "candidate_id": str(candidate.pk) if candidate else None,
            "candidate_revision": candidate.revision if candidate else None,
            "candidate": ExternalListingCandidateSerializer(candidate).data if candidate else None,
            "run": str(page.last_run_id),
            "attempt": page.last_attempt,
            "run_revision": page.last_run.revision,
            "claims": [str(owner) for owner in claims],
            "errors": errors,
        })
    return {
        "source": str(source.pk),
        "actor": str(actor.pk),
        "assignment": assignment.pk,
        "responsibility": source.responsibility_revision,
        "processing": source.processing_revision,
        "paused": source.processing_paused,
        "mode": publication_mode(assignment.approval),
        "items": items,
        "representative": str(assignment.representative_id),
        "submitter": str(assignment.proposal.submitter_id),
    }


def digest(value: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


@transaction.atomic
def preview(
    *, proposal_id: str, actor: User, exception_ids: list[str], action: str, reason: str = ""
) -> dict[str, Any]:
    if action in ("exclude", "request_action") and not reason.strip():
        raise ValidationError("دلیل محدودیت یا متن درخواست لازم است.")
    assignment = scope(proposal_id, actor)
    state = snapshot(assignment, actor, exception_ids, action)
    token = signing.dumps(
        {
            "proposal": str(proposal_id),
            "actor": str(actor.pk),
            "ids": exception_ids,
            "action": action,
            "reason": reason,
            "digest": digest(state),
        },
        salt=SALT,
        compress=True,
    )
    return {"token": token, "source_id": state["source"], "items": state["items"]}


@transaction.atomic
def apply(*, proposal_id: str, actor: User, token: str, confirmed: bool) -> dict[str, Any]:
    if not confirmed:
        raise ValidationError("تأیید صریح لازم است.")
    try:
        payload = signing.loads(token, salt=SALT, max_age=900)
    except signing.BadSignature:
        raise conflict() from None
    if payload["proposal"] != str(proposal_id) or payload["actor"] != str(actor.pk):
        raise conflict()
    assignment = scope(proposal_id, actor)
    key = hashlib.sha256(token.encode()).hexdigest()
    state = snapshot(assignment, actor, payload["ids"], payload["action"])
    if (
        digest(state) != payload["digest"]
        or SourceBulkAction.objects.filter(token_hash=key).exists()
    ):
        raise conflict()
    affected = []
    affected_count = 0
    for item in state["items"]:
        if not item["action_eligible"]:
            continue
        affected_count += 1
        if payload["action"] == "request_action":
            continue
        if payload["action"] == "exclude":
            add_exclusion(
                proposal=assignment.proposal,
                actor=actor,
                kind="exact",
                url=item["url"],
                reason=payload["reason"],
                confirmed=True,
            )
            continue
        candidate = ExternalListingCandidate.objects.select_for_update().get(
            pk=item["candidate_id"]
        )
        publish_candidate(candidate)
        record_candidate_transition(
            candidate=candidate, actor=actor, new_state=ExternalListingCandidateState.PUBLISHED
        )
        candidate.review_claims.filter(released_at__isnull=True).update(released_at=timezone.now())
        affected.append(candidate)
    for run_id in {
        candidate.extraction_run_id for candidate in affected if candidate.extraction_run_id
    }:
        refresh_run_counts(ExtractionRun.objects.get(pk=run_id))
    if payload["action"] == "request_action" and affected_count:
        conversation = open_source_conversation(actor=actor, proposal_id=assignment.proposal_id)
        urls = "\n".join(item["url"] for item in state["items"] if item["action_eligible"])
        send_source_message(
            actor=actor,
            conversation_id=conversation.pk,
            body=f"درخواست اقدام نماینده\n{payload['reason']}\n\nصفحه‌های انتخابی:\n{urls}",
        )
    SourceBulkAction.objects.create(
        source=assignment.source,
        actor=actor,
        token_hash=key,
        action=payload["action"],
        exception_ids=payload["ids"],
    )
    return {"affected": affected_count}
