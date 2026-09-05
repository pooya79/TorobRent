"""Persist the pure extractor's proposal and its bounded review evidence."""

from dataclasses import asdict
from datetime import timedelta
from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Source
from apps.source_extraction.contract import ExtractionContract, ExtractionPage, SourceDiscovery
from apps.source_extraction.contract import SourceProfile as ExtractorProfile

from .models import (
    SourceProfile,
    SourceProfileSnapshots,
    SourceProfileVersion,
    SourceProposal,
    SourceProposalReviewClaim,
    SourceReservation,
)
from .review_claims import SourceProposalReviewConflict


def _version_evidence(
    profile: ExtractorProfile, pages: list[ExtractionPage], contract: ExtractionContract
) -> dict[str, Any]:
    return {
        "rules": dict(profile.mapping),
        "structural_fingerprint": profile.structural_fingerprint,
        "validation": asdict(profile.validation),
        "samples": [asdict(sample) for sample in contract.apply_profile(profile, pages)],
        "diagnostics": dict(profile.mapping_diagnostics),
        "pipeline_version": profile.profile_version,
    }


def retain_discovered_profile(
    reservation: SourceReservation,
    discovery: SourceDiscovery,
    profile: ExtractorProfile,
    contract: ExtractionContract,
) -> None:
    lineage, _ = SourceProfile.objects.get_or_create(source=reservation.source)
    previous = lineage.versions.first()
    urls = (*profile.validation.training_page_urls, *profile.validation.held_out_page_urls)
    pages = [
        ExtractionPage(page.url, page.sanitized_html)
        for page in discovery.pages
        if page.url in urls and page.sanitized_html is not None
    ]
    SourceProfileSnapshots.objects.create(
        reservation=reservation,
        pages=[asdict(page) for page in pages],
        expires_at=timezone.now() + timedelta(days=30),
    )
    SourceProfileVersion.objects.create(
        profile=lineage,
        reservation=reservation,
        number=previous.number + 1 if previous else 1,
        parent=previous,
        **_version_evidence(profile, pages, contract),
        exclusions=list(discovery.excluded_detail_page_urls),
        provenance="discovery",
    )


def review_version(
    *, proposal: SourceProposal, actor: User, reviewed_revision: int, reviewed_profile_version: UUID
) -> tuple[SourceProfileVersion, SourceProposalReviewClaim]:
    from apps.accounts.capabilities import OperatorCapability, has_capability

    from .review_claims import (
        ensure_independent_reviewer,
        require_review_claim,
    )

    if not has_capability(actor, OperatorCapability.REVIEW_SOURCE_PROPOSALS):
        raise ValidationError("Source Proposal Review capability is required.")
    ensure_independent_reviewer(proposal=proposal, actor=actor)
    claim = require_review_claim(
        proposal=proposal, actor=actor, reviewed_revision=reviewed_revision
    )
    reservation = proposal.reservations.filter(revision=proposal.revision).first()
    if not reservation or reservation.released_at or reservation.expires_at <= timezone.now():
        raise SourceProposalReviewConflict(
            "profile_reservation_expired", "The Source reservation is no longer live."
        )
    version = reservation.profile_versions.first()
    if (
        not version
        or str(version.pk) != str(reviewed_profile_version)
        or hasattr(version, "decision")
    ):
        raise SourceProposalReviewConflict(
            "profile_version_conflict", "The proposed profile version changed."
        )
    return version, claim


def extractor_profile(version: SourceProfileVersion) -> ExtractorProfile:
    from apps.source_extraction.contract import ProfileValidation

    # Revalidation only consumes the original split, never stored approval flags.
    return ExtractorProfile(
        mapping=version.rules,
        structural_fingerprint=version.structural_fingerprint,
        mapping_diagnostics={},
        validation=ProfileValidation(
            training_page_urls=tuple(version.validation["training_page_urls"]),
            held_out_page_urls=tuple(version.validation["held_out_page_urls"]),
            required_resolved=0,
            fields={},
            pages=(),
            approval_enabled=False,
        ),
        profile_version=version.pipeline_version,
    )


def validation_pages(version: SourceProfileVersion) -> list[ExtractionPage]:
    snapshots = SourceProfileSnapshots.objects.filter(
        reservation=version.reservation, expires_at__gt=timezone.now()
    ).first()
    if not snapshots:
        raise SourceProposalReviewConflict(
            "profile_evidence_expired",
            "Validation pages expired; repeat URL approval and Discovery.",
        )
    return [ExtractionPage(**page) for page in snapshots.pages]


@transaction.atomic
def edit_profile(
    *,
    proposal: SourceProposal,
    actor: User,
    reviewed_revision: int,
    reviewed_profile_version: UUID,
    rules: dict[str, Any],
) -> SourceProposal:
    proposal = SourceProposal.objects.select_for_update().get(pk=proposal.pk)
    version, _ = review_version(
        proposal=proposal,
        actor=actor,
        reviewed_revision=reviewed_revision,
        reviewed_profile_version=reviewed_profile_version,
    )
    Source.objects.select_for_update().get(pk=version.profile.source_id)
    pages = validation_pages(version)
    contract = ExtractionContract()
    try:
        checked = contract.revalidate_profile(extractor_profile(version), pages, rules)
    except ValueError as exc:
        raise ValidationError(str(exc)) from None
    previous = version.profile.versions.latest("number")
    SourceProfileVersion.objects.create(
        profile=version.profile,
        reservation=version.reservation,
        number=previous.number + 1,
        parent=version,
        **_version_evidence(checked, pages, contract),
        exclusions=version.exclusions,
        provenance="manual",
        created_by=actor,
    )
    return proposal


@transaction.atomic
def approve_profile(
    *,
    proposal: SourceProposal,
    actor: User,
    reviewed_revision: int,
    reviewed_profile_version: UUID,
    confirmed: bool,
    review_mode: str,
) -> SourceProposal:
    from .models import (
        ProfileReviewMode,
        SourceAssignment,
        SourceProfileDecision,
        SourceProposalState,
    )
    from .services import _record_review_decision

    if not confirmed or review_mode not in ProfileReviewMode.values:
        raise ValidationError("Confirm profile approval and choose a supported review mode.")
    proposal = SourceProposal.objects.select_for_update().get(pk=proposal.pk)
    version, claim = review_version(
        proposal=proposal,
        actor=actor,
        reviewed_revision=reviewed_revision,
        reviewed_profile_version=reviewed_profile_version,
    )
    Source.objects.select_for_update().get(pk=version.profile.source_id)
    if (
        proposal.submitter_id is None
        or SourceAssignment.objects
        .filter(source=version.profile.source, revoked_at__isnull=True)
        .exclude(proposal=proposal, representative=proposal.submitter, approval__isnull=False)
        .exists()
    ):
        raise SourceProposalReviewConflict(
            "source_host_unavailable", "The Source cannot be assigned."
        )
    checked = ExtractionContract().revalidate_profile(
        extractor_profile(version), validation_pages(version), version.rules
    )
    if not checked.validation.approval_enabled:
        raise ValidationError("All eight core fields must pass deterministic held-out validation.")
    # URL approvals for a competing case serialize on Source. Recheck after waiting
    # for that lock and validating, because the reservation may have expired meanwhile.
    reservation = SourceReservation.objects.select_for_update().get(pk=version.reservation_id)
    if reservation.released_at or reservation.expires_at <= timezone.now():
        raise SourceProposalReviewConflict(
            "profile_reservation_expired", "The Source reservation is no longer live."
        )
    version.profile.active_version = version
    version.profile.save(update_fields=("active_version",))
    proposal = _record_review_decision(
        proposal=proposal,
        actor=actor,
        claim=claim,
        new_state=SourceProposalState.APPROVED,
        reviewed_profile_version=version.pk,
        review_mode=review_mode,
        reason="پروفایل منبع تأیید شد.",
    )

    assignment = SourceAssignment.objects.filter(
        source=version.profile.source, proposal=proposal, revoked_at__isnull=True
    ).first()
    decision = SourceProfileDecision.objects.get(version=version)
    if assignment:
        assignment.approval = decision
        assignment.save(update_fields=("approval",))
    else:
        SourceAssignment.objects.create(
            source=version.profile.source,
            representative=proposal.submitter,
            proposal=proposal,
            approval=decision,
        )
    return proposal


@transaction.atomic
def start_profile_review(
    *, proposal: SourceProposal, actor: User, reviewed_revision: int, confirmed: bool
) -> SourceProposal:
    """Explicitly pause extraction authority and discover a new version for this case."""
    from apps.accounts.capabilities import OperatorCapability, has_capability

    from .discovery_workflow import approve_url
    from .models import SourceAssignment, SourceProposalEvent, SourceProposalState
    from .review_claims import ensure_independent_reviewer
    from .services import claim_source_proposal_review

    if not has_capability(actor, OperatorCapability.REVIEW_SOURCE_PROPOSALS):
        raise ValidationError("Source Proposal Review capability is required.")
    ensure_independent_reviewer(proposal=proposal, actor=actor)
    if not confirmed:
        raise ValidationError("آغاز بررسی تازه و دریافت صفحات را تأیید کنید.")
    proposal = SourceProposal.objects.select_for_update().get(pk=proposal.pk)
    if proposal.revision != reviewed_revision or proposal.state != SourceProposalState.APPROVED:
        raise SourceProposalReviewConflict("review_revision_conflict", "پرونده تغییر کرده است.")
    if proposal.source_id is None:
        raise ValidationError("منبع فعال لازم است.")
    Source.objects.select_for_update().get(pk=proposal.source_id)
    assignment = (
        SourceAssignment.objects
        .filter(proposal=proposal, revoked_at__isnull=True, representative=proposal.submitter)
        .select_related("approval__event")
        .first()
    )
    if (
        not assignment
        or not assignment.approval
        or assignment.approval.event.actor_id != actor.pk
        or assignment.source.profile.active_version_id != assignment.approval.version_id
    ):
        raise ValidationError("اپراتور مسئول و تخصیص فعال منبع لازم است.")
    proposal.state = SourceProposalState.PENDING
    proposal.revision += 1
    proposal.pending_since = timezone.now()
    proposal.save(update_fields=("state", "revision", "pending_since", "updated_at"))
    SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=actor,
        revision=proposal.revision,
        prior_state=SourceProposalState.APPROVED,
        new_state=SourceProposalState.PENDING,
        reason="بررسی نسخه تازه پروفایل آغاز شد؛ انتشار تا تأیید دوباره متوقف است.",
    )
    claim_source_proposal_review(proposal=proposal, actor=actor)
    return approve_url(
        proposal=proposal, actor=actor, reviewed_revision=proposal.revision, confirmed=True
    )
