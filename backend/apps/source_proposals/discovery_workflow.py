from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict
from datetime import timedelta
from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User
from apps.catalog.models import OutboundPolicy, Source
from apps.source_extraction.contract import (
    ExtractionContract,
    ExtractionContractError,
    SourceDiscovery,
)
from apps.source_extraction.discovery import PageKind
from apps.source_extraction.fetching import FetchBatch, SourcePageFetcher
from apps.source_extraction.observations import redact_phone_numbers

from .models import (
    DiscoveryStage,
    SourceAssignment,
    SourceProposal,
    SourceProposalEvent,
    SourceReservation,
)
from .review_claims import (
    SourceProposalReviewConflict,
    ensure_independent_reviewer,
    require_review_claim,
)
from .url_validation import normalize_public_domain, normalize_public_url

RESERVATION_DURATION = timedelta(hours=24)
# Beyond the Celery hard limit; a retry must never overlap a live fetch attempt.
DISCOVERY_RECOVERY_DELAY = timedelta(minutes=12)


@transaction.atomic
def approve_url(
    *, proposal: SourceProposal, actor: User, reviewed_revision: int, confirmed: bool
) -> SourceProposal:
    if not has_capability(actor, OperatorCapability.REVIEW_SOURCE_PROPOSALS):
        raise ValidationError("Source Proposal Review capability is required.")
    if not confirmed:
        raise ValidationError("URL approval requires confirmation.")
    proposal = SourceProposal.objects.select_for_update().get(pk=proposal.pk)
    ensure_independent_reviewer(proposal=proposal, actor=actor)
    require_review_claim(proposal=proposal, actor=actor, reviewed_revision=reviewed_revision)
    if proposal.reservations.filter(
        released_at__isnull=True, expires_at__gt=timezone.now()
    ).exists():
        raise SourceProposalReviewConflict(
            "url_already_approved", "This URL has already been approved."
        )
    proposal.website_url = normalize_public_url(proposal.website_url)
    proposal.normalized_domain = normalize_public_domain(proposal.website_url)
    if (
        proposal.sitemap_url
        and normalize_public_domain(proposal.sitemap_url) != proposal.normalized_domain
    ):
        raise ValidationError("Sitemap must use the same exact host.")
    source, _ = Source.objects.get_or_create(
        domain=proposal.normalized_domain,
        defaults={
            "name": f"external-{proposal.id}",
            "display_name": proposal.website_name[:120],
            "outbound_policy": OutboundPolicy.EXTERNAL_LINK,
        },
    )
    Source.objects.select_for_update().get(pk=source.pk)
    now = timezone.now()
    # Expired reservations remain in history but cannot block another approval.
    SourceReservation.objects.filter(
        source=source, released_at__isnull=True, expires_at__lte=now
    ).update(released_at=now, release_reason="expired")
    if (
        SourceReservation.objects.filter(source=source, released_at__isnull=True).exists()
        or SourceAssignment.objects
        .filter(source=source, revoked_at__isnull=True)
        .exclude(proposal=proposal, representative=proposal.submitter, approval__isnull=False)
        .exists()
    ):
        raise SourceProposalReviewConflict(
            "source_host_unavailable", "This exact host is reserved or assigned."
        )
    reservation = SourceReservation.objects.create(
        source=source,
        proposal=proposal,
        revision=proposal.revision,
        approved_url=proposal.website_url,
        expires_at=now + RESERVATION_DURATION,
    )
    proposal.source = source
    proposal.discovery_stage = DiscoveryStage.QUEUED
    proposal.save(
        update_fields=(
            "source",
            "website_url",
            "normalized_domain",
            "discovery_stage",
            "updated_at",
        )
    )
    SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=actor,
        revision=proposal.revision,
        prior_state=proposal.state,
        new_state=proposal.state,
        reason="نشانی برای کشف تأیید و دامنه رزرو شد.",
    )
    from .tasks import discover_source

    transaction.on_commit(lambda: discover_source.delay(str(reservation.pk)))
    return proposal


class ReservedSourceFetcher:
    """Recheck the human authorization between bounded fetches and record progress."""

    def __init__(self, reservation: SourceReservation) -> None:
        self.reservation_id = reservation.pk
        self.fetcher = SourcePageFetcher(approved_host=reservation.source.domain)
        self.visited: set[str] = set()

    def fetch(self, urls: Sequence[str], *, render: bool = False) -> FetchBatch:
        live = SourceReservation.objects.filter(
            pk=self.reservation_id, released_at__isnull=True, expires_at__gt=timezone.now()
        )
        if not live.exists():
            raise RuntimeError("Source authorization ended")
        result = self.fetcher.fetch(urls, render=render)
        self.visited.update(record.requested_url for record in result.records)
        live.update(evidence={"page_count": len(self.visited)})
        return result


def discovery_evidence(result: SourceDiscovery) -> dict[str, Any]:
    # Prioritize representatives of each structure, then fill with other classifications.
    by_url = {page.url: page for page in result.pages}
    sample_urls = list(
        dict.fromkeys(
            [url for group in result.structures for url in group.page_urls[:2]]
            + [page.url for page in result.pages]
        )
    )[:12]
    evidence = {
        "page_count": len(result.pages),
        "detail_page_count": result.detail_page_count,
        "classifications": dict(Counter(page.classification.kind for page in result.pages)),
        "structures": [asdict(group) for group in result.structures],
        "exclusions": list(result.excluded_detail_page_urls),
        "samples": [
            {
                "url": url,
                "classification": by_url[url].classification.kind,
                "evidence": list(by_url[url].classification.evidence),
            }
            for url in sample_urls
        ],
        "failures": [
            {
                "url": page.url,
                "code": page.fetch_failure.code if page.fetch_failure else "unsupported_response",
                "detail": "؛ ".join(page.classification.evidence)[:500],
            }
            for page in result.pages
            if page.classification.kind == PageKind.FETCH_ERROR
        ][:20],
    }
    return {key: redact_evidence(value) for key, value in evidence.items()}


def redact_evidence(value: Any) -> Any:
    if isinstance(value, str):
        return redact_phone_numbers(value)
    if isinstance(value, dict):
        return {key: redact_evidence(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [redact_evidence(item) for item in value]
    return value


def run_discovery(reservation_id: str) -> None:
    recover_interrupted_discovery(reservation_id)
    proposal_id = SourceReservation.objects.values_list("proposal_id", flat=True).get(
        pk=reservation_id
    )
    with transaction.atomic():
        SourceProposal.objects.select_for_update().get(pk=proposal_id)
        reservation = SourceReservation.objects.select_for_update().get(pk=reservation_id)
        if (
            reservation.started_at
            or reservation.released_at
            or reservation.expires_at <= timezone.now()
        ):
            return
        reservation.started_at = timezone.now()
        reservation.save(update_fields=("started_at",))
        SourceProposal.objects.filter(pk=reservation.proposal_id).update(
            discovery_stage=DiscoveryStage.RUNNING
        )
    profile = None
    try:
        contract = ExtractionContract(ReservedSourceFetcher(reservation))
        result = contract.discover(reservation.approved_url)
        evidence = discovery_evidence(result)
        try:
            profile = contract.propose_profile(result)
        except ExtractionContractError:
            evidence["profile_failure"] = (
                "ساختار پشتیبانی‌شده با حداقل ده صفحه برای آموزش و اعتبارسنجی یافت نشد."
            )
        stage = (
            DiscoveryStage.COMPLETE
            if any(
                page.classification.kind not in (PageKind.FETCH_ERROR, PageKind.BLOCKED)
                for page in result.pages
            )
            else DiscoveryStage.FAILED
        )
    except Exception:
        # Do not expose transport exceptions, response bodies, credentials or phone values.
        evidence = {
            "failures": [
                {"code": "discovery_failed", "detail": "کشف ناموفق بود؛ دوباره بررسی کنید."}
            ]
        }
        stage = DiscoveryStage.FAILED
    with transaction.atomic():
        proposal = SourceProposal.objects.select_for_update().get(pk=reservation.proposal_id)
        reservation = SourceReservation.objects.select_for_update().get(pk=reservation_id)
        if reservation.completed_at is not None:
            return
        reservation.evidence = evidence
        reservation.completed_at = timezone.now()
        reservation.save(update_fields=("evidence", "completed_at"))
        if (
            reservation.released_at
            or reservation.expires_at <= timezone.now()
            or proposal.revision != reservation.revision
        ):
            return
        if profile is not None:
            from .profiles import retain_discovered_profile

            Source.objects.select_for_update().get(pk=reservation.source_id)
            retain_discovered_profile(reservation, result, profile, contract)
        proposal.discovery_stage = stage
        proposal.save(update_fields=("discovery_stage", "updated_at"))
        if stage == DiscoveryStage.FAILED:
            release_reservations(proposal, "failed")
        SourceProposalEvent.objects.create(
            proposal=proposal,
            actor=None,
            revision=proposal.revision,
            prior_state=proposal.state,
            new_state=proposal.state,
            reason="کشف پایان یافت." if stage == DiscoveryStage.COMPLETE else "کشف ناموفق بود.",
        )


def release_reservations(proposal: SourceProposal, reason: str) -> None:
    SourceReservation.objects.filter(proposal=proposal, released_at__isnull=True).update(
        released_at=timezone.now(),
        release_reason=reason,
    )


@transaction.atomic
def release_case(
    *,
    proposal: SourceProposal,
    actor: User,
    reviewed_revision: int,
    reason: str,
) -> SourceProposal:
    proposal = SourceProposal.objects.select_for_update().get(pk=proposal.pk)
    if not reason.strip():
        raise ValidationError("A release reason is required.")
    if proposal.state != "pending":
        raise SourceProposalReviewConflict(
            "review_decision_conflict", "Only pending cases can be released."
        )
    manager = has_capability(actor, OperatorCapability.MANAGE_OPERATOR_QUEUES)
    if not manager:
        ensure_independent_reviewer(proposal=proposal, actor=actor)
        require_review_claim(proposal=proposal, actor=actor, reviewed_revision=reviewed_revision)
    elif proposal.revision != reviewed_revision:
        raise SourceProposalReviewConflict("review_revision_conflict", "The revision changed.")
    release_reservations(proposal, "abandoned")
    proposal.review_claims.filter(released_at__isnull=True).update(released_at=timezone.now())
    proposal.discovery_stage = DiscoveryStage.RELEASED
    proposal.save(update_fields=("discovery_stage", "updated_at"))
    SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=actor,
        revision=proposal.revision,
        prior_state=proposal.state,
        new_state=proposal.state,
        reason=f"رزرو و مسئولیت بررسی آزاد شد: {reason.strip()}",
    )
    return proposal


@transaction.atomic
def recover_interrupted_discovery(reservation_id: str) -> None:
    proposal_id = SourceReservation.objects.values_list("proposal_id", flat=True).get(
        pk=reservation_id
    )
    proposal = SourceProposal.objects.select_for_update().get(pk=proposal_id)
    reservation = SourceReservation.objects.select_for_update().get(pk=reservation_id)
    if (
        reservation.released_at
        or reservation.completed_at
        or not reservation.started_at
        or reservation.started_at > timezone.now() - DISCOVERY_RECOVERY_DELAY
    ):
        return
    reservation.completed_at = timezone.now()
    reservation.released_at = reservation.completed_at
    reservation.release_reason = "failed"
    reservation.evidence = {
        **reservation.evidence,
        "failures": [
            {
                "code": "worker_interrupted",
                "detail": "پردازش متوقف شد؛ شروع دوباره نیازمند تأیید اپراتور است.",
            }
        ],
    }
    reservation.save(update_fields=("completed_at", "released_at", "release_reason", "evidence"))
    if proposal.revision == reservation.revision and proposal.state == "pending":
        proposal.discovery_stage = DiscoveryStage.FAILED
        proposal.save(update_fields=("discovery_stage", "updated_at"))
    SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=None,
        revision=reservation.revision,
        prior_state=proposal.state,
        new_state=proposal.state,
        reason="پردازش کشف متوقف و رزرو آزاد شد.",
    )


def expire_reservations() -> None:
    from .models import SourceProfileSnapshots

    SourceProfileSnapshots.objects.filter(expires_at__lte=timezone.now()).delete()
    interrupted = SourceReservation.objects.filter(
        released_at__isnull=True,
        completed_at__isnull=True,
        started_at__lte=timezone.now() - DISCOVERY_RECOVERY_DELAY,
    ).values_list("id", flat=True)
    for reservation_id in interrupted:
        recover_interrupted_discovery(str(reservation_id))
    ids = SourceReservation.objects.filter(
        released_at__isnull=True, expires_at__lte=timezone.now()
    ).values_list("proposal_id", flat=True)
    for proposal_id in ids:
        with transaction.atomic():
            proposal = SourceProposal.objects.select_for_update().get(pk=proposal_id)
            expired = proposal.reservations.filter(
                released_at__isnull=True, expires_at__lte=timezone.now()
            )
            if not expired.update(released_at=timezone.now(), release_reason="expired"):
                continue
            proposal.discovery_stage = DiscoveryStage.RELEASED
            proposal.save(update_fields=("discovery_stage", "updated_at"))
            SourceProposalEvent.objects.create(
                proposal=proposal,
                actor=None,
                revision=proposal.revision,
                prior_state=proposal.state,
                new_state=proposal.state,
                reason="رزرو دامنه منقضی شد.",
            )
