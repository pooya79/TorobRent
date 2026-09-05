import uuid
from dataclasses import dataclass
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import TEHRAN_CITY_ID, Neighborhood, PropertyType
from apps.catalog.services import ExternalListingSpec, materialize_external_listing
from apps.communications.services import create_source_proposal_review_notification

from .models import (
    DiscoveryStage,
    ExternalListingCandidate,
    ExternalListingCandidateEvent,
    ExternalListingCandidateReviewClaim,
    ExternalListingCandidateState,
    SourceProposal,
    SourceProposalEvent,
    SourceProposalReviewClaim,
    SourceProposalState,
    SourceProposalStep,
)
from .review_claims import (
    SourceProposalReviewConflict,
    active_review_claim,
    ensure_independent_reviewer,
    require_review_claim,
)
from .url_validation import normalize_public_domain, normalize_public_url


@dataclass(frozen=True)
class SimulatedCandidateSpec:
    slug: str
    title: str
    property_type: PropertyType
    area_sqm: int
    room_count: int | None
    deposit_rial: int
    monthly_rent_rial: int


SIMULATED_CANDIDATE_SPECS = (
    SimulatedCandidateSpec(
        slug="residential-1",
        title="آپارتمان شبیه‌سازی‌شده برای بررسی",
        property_type=PropertyType.APARTMENT,
        area_sqm=85,
        room_count=2,
        deposit_rial=5_000_000_000,
        monthly_rent_rial=250_000_000,
    ),
    SimulatedCandidateSpec(
        slug="commercial-2",
        title="دفتر شبیه‌سازی‌شده برای بررسی",
        property_type=PropertyType.OFFICE,
        area_sqm=110,
        room_count=None,
        deposit_rial=8_000_000_000,
        monthly_rent_rial=400_000_000,
    ),
)


@transaction.atomic
def generate_simulated_external_listing_candidates(
    *, proposal: SourceProposal
) -> list[ExternalListingCandidate]:
    proposal = (
        SourceProposal.objects
        .select_for_update(of=("self",))
        .select_related("source")
        .get(id=proposal.id)
    )
    source = proposal.source
    if proposal.state != SourceProposalState.APPROVED or source is None:
        raise ValidationError("Only an approved Source Proposal can produce Listing candidates.")
    neighborhoods = list(
        Neighborhood.objects
        .filter(
            reviewed=True,
            district__reviewed=True,
            district__city_id=TEHRAN_CITY_ID,
            district__city__reviewed=True,
        )
        .select_related("district")
        .order_by("district__number", "name_fa")[: len(SIMULATED_CANDIDATE_SPECS)]
    )
    if len(neighborhoods) < len(SIMULATED_CANDIDATE_SPECS):
        return []
    candidates: list[ExternalListingCandidate] = []
    for index, (spec, neighborhood) in enumerate(
        zip(SIMULATED_CANDIDATE_SPECS, neighborhoods, strict=True), start=1
    ):
        external_url = f"https://{proposal.normalized_domain}/sample-listings/{spec.slug}"
        candidate, _created = ExternalListingCandidate.objects.get_or_create(
            id=uuid.uuid5(proposal.id, f"simulated-external-listing-{index}"),
            defaults={
                "source_proposal": proposal,
                "source": source,
                "title": spec.title,
                "external_url": external_url,
                "city_id": TEHRAN_CITY_ID,
                "district": neighborhood.district,
                "neighborhood": neighborhood,
                "property_type": spec.property_type,
                "area_sqm": spec.area_sqm,
                "room_count": spec.room_count,
                "deposit_rial": spec.deposit_rial,
                "monthly_rent_rial": spec.monthly_rent_rial,
                "description": (
                    "داده ساختگی و محلی برای اثبات مرز بررسی؛ هیچ رسانه یا "
                    "داده‌ای از وب‌سایت Source دریافت نشده است."
                ),
            },
        )
        candidates.append(candidate)
    return candidates


SOURCE_PROPOSAL_CLAIM_DURATION = timedelta(minutes=15)


class SourceProposalAccessDenied(Exception):
    pass


def _lock_editable_source_proposal(*, proposal: SourceProposal, actor: User) -> SourceProposal:
    locked = SourceProposal.objects.select_for_update().get(id=proposal.id)
    if locked.submitter_id != actor.id or locked.state not in (
        SourceProposalState.DRAFT,
        SourceProposalState.CHANGES_REQUESTED,
    ):
        raise SourceProposalAccessDenied("این Source Proposal قابل ویرایش نیست.")
    if locked.state == SourceProposalState.CHANGES_REQUESTED:
        prior_state = locked.state
        locked.revision += 1
        locked.state = SourceProposalState.DRAFT
        locked.pending_since = None
        locked.discovery_stage = DiscoveryStage.AWAITING_URL
        locked.save(
            update_fields=("revision", "state", "pending_since", "discovery_stage", "updated_at")
        )
        SourceProposalEvent.objects.create(
            proposal=locked,
            actor=actor,
            revision=locked.revision,
            prior_state=prior_state,
            new_state=SourceProposalState.DRAFT,
            reason="نسخه جدید برای ویرایش ایجاد شد.",
        )
    return locked


@transaction.atomic
def resume_or_create_source_proposal(
    *, submitter: User, start_new: bool = False
) -> tuple[SourceProposal, bool]:
    if not submitter.is_submitter or not submitter.phone_verified:
        raise SourceProposalAccessDenied(
            "برای معرفی وب‌سایت ابتدا شماره تلفن حساب ارسال‌کننده را تأیید کنید."
        )
    User.objects.select_for_update().get(pk=submitter.pk)
    existing = (
        SourceProposal.objects
        .select_for_update()
        .filter(
            submitter=submitter,
            discarded_at__isnull=True,
            state__in=(SourceProposalState.DRAFT, SourceProposalState.CHANGES_REQUESTED),
        )
        .first()
    )
    if existing is not None:
        return existing, False
    if start_new:
        return SourceProposal.objects.create(submitter=submitter), True
    pending = SourceProposal.objects.filter(
        submitter=submitter,
        discarded_at__isnull=True,
        state=SourceProposalState.PENDING,
    ).first()
    if pending is not None:
        return pending, False
    return SourceProposal.objects.create(submitter=submitter), True


@transaction.atomic
def delete_source_proposal_draft(*, proposal: SourceProposal, actor: User) -> None:
    locked = SourceProposal.objects.select_for_update().get(id=proposal.id)
    if locked.submitter_id != actor.id or not locked.can_discard:
        raise SourceProposalAccessDenied("فقط پیش‌نویس قابل حذف است.")
    locked.discarded_at = timezone.now()
    locked.save(update_fields=("discarded_at", "updated_at"))


def _ensure_account_domain_available(
    *, proposal: SourceProposal, actor: User, normalized_domain: str
) -> None:
    if (
        SourceProposal.objects
        .filter(
            submitter=actor,
            discarded_at__isnull=True,
            normalized_domain=normalized_domain,
            state__in=(
                SourceProposalState.DRAFT,
                SourceProposalState.PENDING,
                SourceProposalState.CHANGES_REQUESTED,
            ),
        )
        .exclude(id=proposal.id)
        .exists()
    ):
        raise ValidationError("یک Source Proposal باز برای این دامنه دارید.")


@transaction.atomic
def save_source_proposal_draft(
    *, proposal: SourceProposal, actor: User, validated_data: dict[str, object]
) -> SourceProposal:
    locked = _lock_editable_source_proposal(proposal=proposal, actor=actor)
    if "website_url" in validated_data:
        website_url = str(validated_data["website_url"])
        normalized_domain = normalize_public_domain(website_url) if website_url else ""
        if normalized_domain:
            _ensure_account_domain_available(
                proposal=locked,
                actor=actor,
                normalized_domain=normalized_domain,
            )
        locked.normalized_domain = normalized_domain
    sitemap_url = str(validated_data.get("sitemap_url", locked.sitemap_url))
    website_url = str(validated_data.get("website_url", locked.website_url))
    if sitemap_url and (
        not website_url
        or normalize_public_domain(sitemap_url) != normalize_public_domain(website_url)
    ):
        raise ValidationError("نشانی نقشه یا خوراک باید متعلق به همان دامنه وب‌سایت باشد.")
    for field, value in validated_data.items():
        if field in ("website_url", "sitemap_url") and value:
            value = normalize_public_url(str(value))
        setattr(locked, field, value)
    locked.current_step = SourceProposalStep.DETAILS
    locked.preview = {}
    locked.preview_confirmed = False
    locked.save()
    return locked


@transaction.atomic
def save_source_proposal_details(
    *, proposal: SourceProposal, actor: User, validated_data: dict[str, object]
) -> SourceProposal:
    locked = _lock_editable_source_proposal(proposal=proposal, actor=actor)
    normalized_domain = normalize_public_domain(str(validated_data["website_url"]))
    sitemap_url = str(validated_data.get("sitemap_url", locked.sitemap_url))
    if sitemap_url and normalize_public_domain(sitemap_url) != normalized_domain:
        raise ValidationError("نشانی نقشه یا خوراک باید متعلق به همان دامنه وب‌سایت باشد.")
    _ensure_account_domain_available(
        proposal=locked, actor=actor, normalized_domain=normalized_domain
    )
    for field, value in validated_data.items():
        if field in ("website_url", "sitemap_url") and value:
            value = normalize_public_url(str(value))
        setattr(locked, field, value)
    locked.normalized_domain = normalized_domain
    locked.current_step = SourceProposalStep.PREVIEW
    locked.preview = {}
    locked.preview_confirmed = False
    locked.needs_reconciliation = (
        SourceProposal.objects
        .filter(
            discarded_at__isnull=True,
            normalized_domain=normalized_domain,
            state__in=(
                SourceProposalState.DRAFT,
                SourceProposalState.PENDING,
                SourceProposalState.CHANGES_REQUESTED,
            ),
        )
        .exclude(submitter=actor)
        .exists()
    )
    locked.save()
    return locked


@transaction.atomic
def generate_proposal_preview(*, proposal: SourceProposal, actor: User) -> SourceProposal:
    locked = _lock_editable_source_proposal(proposal=proposal, actor=actor)
    if locked.current_step != SourceProposalStep.PREVIEW or not locked.normalized_domain:
        raise ValidationError("ابتدا اطلاعات وب‌سایت را کامل کنید.")
    locked.preview = {
        "simulated": False,
        "title": "بازبینی اطلاعات وب‌سایت",
        "disclaimer": "تا پیش از تأیید نشانی توسط اپراتور هیچ درخواستی به وب‌سایت ارسال نمی‌شود.",
        "estimated_count": None,
        "inventory_range": locked.inventory_range,
        "examples": [],
    }
    locked.preview_confirmed = False
    locked.save(update_fields=("preview", "preview_confirmed", "updated_at"))
    return locked


@transaction.atomic
def submit_source_proposal(*, proposal: SourceProposal, actor: User) -> SourceProposal:
    locked = _lock_editable_source_proposal(proposal=proposal, actor=actor)
    if not locked.preview or locked.current_step != SourceProposalStep.PREVIEW:
        raise ValidationError("ابتدا اطلاعات وب‌سایت را بازبینی کنید.")
    prior_state = locked.state
    locked.preview_confirmed = True
    locked.state = SourceProposalState.PENDING
    locked.pending_since = timezone.now()
    locked.save(update_fields=("preview_confirmed", "state", "pending_since", "updated_at"))
    SourceProposalEvent.objects.create(
        proposal=locked,
        actor=actor,
        revision=locked.revision,
        prior_state=prior_state,
        new_state=SourceProposalState.PENDING,
    )
    return locked


@transaction.atomic
def claim_source_proposal_review(
    *, proposal: SourceProposal, actor: User
) -> SourceProposalReviewClaim:
    proposal = SourceProposal.objects.select_for_update().get(id=proposal.id)
    ensure_independent_reviewer(proposal=proposal, actor=actor)
    if proposal.state != SourceProposalState.PENDING:
        raise ValidationError("Only a pending Source Proposal can be claimed.")
    now = timezone.now()
    claim = active_review_claim(proposal)
    if claim is not None and claim.expires_at <= now:
        claim.released_at = now
        claim.save(update_fields=("released_at",))
        claim = None
    if claim is not None:
        if claim.operator_id == actor.id:
            claim.expires_at = now + SOURCE_PROPOSAL_CLAIM_DURATION
            claim.save(update_fields=("expires_at",))
            return claim
        raise SourceProposalReviewConflict(
            "review_claim_conflict",
            "This Source Proposal is already claimed by another Operator.",
        )
    return SourceProposalReviewClaim.objects.create(
        proposal=proposal,
        operator=actor,
        revision=proposal.revision,
        expires_at=now + SOURCE_PROPOSAL_CLAIM_DURATION,
    )


@transaction.atomic
def request_source_proposal_changes(
    *,
    proposal: SourceProposal,
    actor: User,
    reviewed_revision: int,
    reason: str,
    reviewed_profile_version: uuid.UUID | None = None,
) -> SourceProposal:
    proposal = SourceProposal.objects.select_for_update().get(id=proposal.id)
    ensure_independent_reviewer(proposal=proposal, actor=actor)
    claim = require_review_claim(
        proposal=proposal, actor=actor, reviewed_revision=reviewed_revision
    )
    reason = reason.strip()
    if not reason:
        raise ValidationError("Request Changes requires a reason.")
    return _record_review_decision(
        proposal=proposal,
        actor=actor,
        claim=claim,
        reviewed_profile_version=reviewed_profile_version,
        new_state=SourceProposalState.CHANGES_REQUESTED,
        reason=reason,
    )


def _required_reason(reason: str) -> str:
    reason = reason.strip()
    if not reason:
        raise ValidationError("A rejection requires a reason.")
    return reason


def _record_review_decision(
    *,
    proposal: SourceProposal,
    actor: User,
    claim: SourceProposalReviewClaim,
    new_state: SourceProposalState,
    reason: str = "",
    reviewed_profile_version: uuid.UUID | None = None,
    review_mode: str = "",
) -> SourceProposal:
    from .discovery_workflow import release_reservations
    from .models import SourceProfileDecision, SourceProfileVersion

    version = SourceProfileVersion.objects.filter(
        reservation__proposal=proposal, reservation__revision=proposal.revision
    ).first()
    if version and (
        str(version.pk) != str(reviewed_profile_version) or hasattr(version, "decision")
    ):
        raise SourceProposalReviewConflict(
            "profile_version_conflict", "The proposed profile version changed."
        )
    release_reservations(proposal, str(new_state))
    prior_state = proposal.state
    proposal.state = new_state
    proposal.pending_since = None
    proposal.save(update_fields=("state", "pending_since", "updated_at"))
    decision = SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=actor,
        revision=proposal.revision,
        prior_state=prior_state,
        new_state=new_state,
        reason=reason,
    )
    if version:
        SourceProfileDecision.objects.create(
            version=version, event=decision, review_mode=review_mode
        )
    create_source_proposal_review_notification(decision)
    claim.released_at = timezone.now()
    claim.save(update_fields=("released_at",))
    return proposal


@transaction.atomic
def reject_source_proposal(
    *,
    proposal: SourceProposal,
    actor: User,
    reviewed_revision: int,
    reason: str,
    reviewed_profile_version: uuid.UUID | None = None,
) -> SourceProposal:
    proposal = SourceProposal.objects.select_for_update().get(id=proposal.id)
    ensure_independent_reviewer(proposal=proposal, actor=actor)
    claim = require_review_claim(
        proposal=proposal, actor=actor, reviewed_revision=reviewed_revision
    )
    return _record_review_decision(
        proposal=proposal,
        actor=actor,
        claim=claim,
        reviewed_profile_version=reviewed_profile_version,
        new_state=SourceProposalState.REJECTED,
        reason=_required_reason(reason),
    )


EXTERNAL_CANDIDATE_CLAIM_DURATION = timedelta(minutes=15)


def _ensure_candidate_not_representative(
    *, candidate: ExternalListingCandidate, actor: User
) -> None:
    if candidate.source_proposal.submitter_id == actor.id:
        raise ValidationError("An Operator cannot decide their own External Listing candidate.")


def _active_candidate_claim(
    candidate: ExternalListingCandidate,
) -> ExternalListingCandidateReviewClaim | None:
    return candidate.review_claims.filter(released_at__isnull=True).first()


@transaction.atomic
def claim_external_listing_candidate_review(
    *, candidate: ExternalListingCandidate, actor: User
) -> ExternalListingCandidateReviewClaim:
    candidate = (
        ExternalListingCandidate.objects
        .select_for_update()
        .select_related("source_proposal")
        .get(id=candidate.id)
    )
    _ensure_candidate_not_representative(candidate=candidate, actor=actor)
    if candidate.state != ExternalListingCandidateState.PENDING:
        raise ValidationError("Only a pending External Listing candidate can be claimed.")
    now = timezone.now()
    claim = _active_candidate_claim(candidate)
    if claim is not None and claim.expires_at <= now:
        claim.released_at = now
        claim.save(update_fields=("released_at",))
        claim = None
    if claim is not None:
        if claim.operator_id == actor.id:
            return claim
        raise SourceProposalReviewConflict(
            "review_claim_conflict",
            "This External Listing candidate is already claimed by another Operator.",
        )
    return ExternalListingCandidateReviewClaim.objects.create(
        candidate=candidate,
        operator=actor,
        revision=candidate.revision,
        expires_at=now + EXTERNAL_CANDIDATE_CLAIM_DURATION,
    )


def _current_candidate_claim(
    *, candidate: ExternalListingCandidate, actor: User, reviewed_revision: int
) -> ExternalListingCandidateReviewClaim:
    if candidate.revision != reviewed_revision:
        raise SourceProposalReviewConflict(
            "review_revision_conflict", "The candidate revision changed. Refresh it."
        )
    if candidate.state != ExternalListingCandidateState.PENDING:
        raise SourceProposalReviewConflict(
            "review_decision_conflict", "Another decision already changed this candidate."
        )
    claim = _active_candidate_claim(candidate)
    if claim is None or claim.operator_id != actor.id:
        raise SourceProposalReviewConflict(
            "review_claim_required", "A current Review Claim owned by this Operator is required."
        )
    if claim.expires_at <= timezone.now():
        claim.released_at = timezone.now()
        claim.save(update_fields=("released_at",))
        raise SourceProposalReviewConflict("review_claim_expired", "The Review Claim expired.")
    return claim


def _record_candidate_decision(
    *,
    candidate: ExternalListingCandidate,
    actor: User,
    claim: ExternalListingCandidateReviewClaim,
    new_state: ExternalListingCandidateState,
    reason: str = "",
) -> ExternalListingCandidate:
    prior_state = candidate.state
    candidate.state = new_state
    candidate.save(update_fields=("state", "updated_at"))
    ExternalListingCandidateEvent.objects.create(
        candidate=candidate,
        actor=actor,
        revision=candidate.revision,
        prior_state=prior_state,
        new_state=new_state,
        reason=reason,
    )
    claim.released_at = timezone.now()
    claim.save(update_fields=("released_at",))
    return candidate


def _candidate_reason(reason: str) -> str:
    reason = reason.strip()
    if not reason:
        raise ValidationError("A rejection or Request Changes decision requires a reason.")
    return reason


@transaction.atomic
def request_external_listing_candidate_changes(
    *, candidate: ExternalListingCandidate, actor: User, reviewed_revision: int, reason: str
) -> ExternalListingCandidate:
    candidate = (
        ExternalListingCandidate.objects
        .select_for_update()
        .select_related("source_proposal")
        .get(id=candidate.id)
    )
    _ensure_candidate_not_representative(candidate=candidate, actor=actor)
    claim = _current_candidate_claim(
        candidate=candidate, actor=actor, reviewed_revision=reviewed_revision
    )
    return _record_candidate_decision(
        candidate=candidate,
        actor=actor,
        claim=claim,
        new_state=ExternalListingCandidateState.CHANGES_REQUESTED,
        reason=_candidate_reason(reason),
    )


@transaction.atomic
def reject_external_listing_candidate(
    *, candidate: ExternalListingCandidate, actor: User, reviewed_revision: int, reason: str
) -> ExternalListingCandidate:
    candidate = (
        ExternalListingCandidate.objects
        .select_for_update()
        .select_related("source_proposal")
        .get(id=candidate.id)
    )
    _ensure_candidate_not_representative(candidate=candidate, actor=actor)
    claim = _current_candidate_claim(
        candidate=candidate, actor=actor, reviewed_revision=reviewed_revision
    )
    return _record_candidate_decision(
        candidate=candidate,
        actor=actor,
        claim=claim,
        new_state=ExternalListingCandidateState.REJECTED,
        reason=_candidate_reason(reason),
    )


@transaction.atomic
def approve_external_listing_candidate(
    *, candidate: ExternalListingCandidate, actor: User, reviewed_revision: int, confirmed: bool
) -> ExternalListingCandidate:
    if not confirmed:
        raise ValidationError("External Listing approval requires confirmation.")
    candidate = (
        ExternalListingCandidate.objects
        .select_for_update()
        .select_related("source_proposal", "source")
        .get(id=candidate.id)
    )
    _ensure_candidate_not_representative(candidate=candidate, actor=actor)
    claim = _current_candidate_claim(
        candidate=candidate, actor=actor, reviewed_revision=reviewed_revision
    )
    listing = materialize_external_listing(
        spec=ExternalListingSpec(
            source=candidate.source,
            property_values={
                "city": candidate.city,
                "district": candidate.district,
                "neighborhood": candidate.neighborhood,
                "property_type": candidate.property_type,
                "area_sqm": candidate.area_sqm,
                "room_count": candidate.room_count,
                "provenance_note": (
                    f"کاندیدای شبیه‌سازی‌شده از Source Proposal {candidate.source_proposal_id}"
                ),
            },
            terms_values={
                "deposit_rial": candidate.deposit_rial,
                "monthly_rent_rial": candidate.monthly_rent_rial,
            },
            listing_values={
                "description": candidate.description,
                "source_reference": str(candidate.id),
                "source_claims": {"simulated": True},
                "provenance_note": (
                    f"Source Proposal {candidate.source_proposal_id}; original URL retained."
                ),
                "external_url": candidate.external_url,
                "external_media_url": "",
                "direct_phone": "",
            },
        )
    )
    candidate.listing = listing
    candidate.save(update_fields=("listing", "updated_at"))
    return _record_candidate_decision(
        candidate=candidate,
        actor=actor,
        claim=claim,
        new_state=ExternalListingCandidateState.PUBLISHED,
    )
