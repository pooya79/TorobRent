import ipaddress
from datetime import timedelta
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import OutboundPolicy, Source

from .models import (
    SourceProposal,
    SourceProposalEvent,
    SourceProposalReviewClaim,
    SourceProposalState,
    SourceProposalStep,
)

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
        locked.save(update_fields=("revision", "state", "pending_since", "updated_at"))
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
            state__in=(SourceProposalState.DRAFT, SourceProposalState.CHANGES_REQUESTED),
        )
        .first()
    )
    if existing is not None:
        return existing, False
    if start_new:
        return SourceProposal.objects.create(submitter=submitter), True
    pending = SourceProposal.objects.filter(
        submitter=submitter, state=SourceProposalState.PENDING
    ).first()
    if pending is not None:
        return pending, False
    return SourceProposal.objects.create(submitter=submitter), True


def normalize_public_domain(url: str) -> str:
    parts = urlsplit(url)
    hostname = parts.hostname
    if hostname is None or parts.scheme not in {"http", "https"}:
        raise ValidationError("نشانی باید یک URL عمومی امن با http یا https باشد.")
    if parts.username or parts.password:
        raise ValidationError("نشانی باید یک URL عمومی امن با http یا https باشد.")
    hostname = hostname.rstrip(".").lower()
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise ValidationError("نشانی عددی یا شبکه داخلی پذیرفته نمی‌شود.")
    if hostname == "localhost" or "." not in hostname:
        raise ValidationError("دامنه عمومی معتبر وارد کنید.")
    try:
        normalized = hostname.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValidationError("دامنه معتبر نیست.") from exc
    return normalized.removeprefix("www.")


def _ensure_account_domain_available(
    *, proposal: SourceProposal, actor: User, normalized_domain: str
) -> None:
    if (
        SourceProposal.objects
        .filter(
            submitter=actor,
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
    sitemap_url = str(validated_data.get("sitemap_url", ""))
    website_url = str(validated_data.get("website_url", locked.website_url))
    if sitemap_url and (
        not website_url
        or normalize_public_domain(sitemap_url) != normalize_public_domain(website_url)
    ):
        raise ValidationError("نشانی نقشه یا خوراک باید متعلق به همان دامنه وب‌سایت باشد.")
    for field, value in validated_data.items():
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
    sitemap_url = str(validated_data.get("sitemap_url", ""))
    if sitemap_url and normalize_public_domain(sitemap_url) != normalized_domain:
        raise ValidationError("نشانی نقشه یا خوراک باید متعلق به همان دامنه وب‌سایت باشد.")
    _ensure_account_domain_available(
        proposal=locked, actor=actor, normalized_domain=normalized_domain
    )
    for field, value in validated_data.items():
        setattr(locked, field, value)
    locked.normalized_domain = normalized_domain
    locked.current_step = SourceProposalStep.PREVIEW
    locked.preview = {}
    locked.preview_confirmed = False
    locked.needs_reconciliation = (
        SourceProposal.objects
        .filter(
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
def generate_simulated_preview(*, proposal: SourceProposal, actor: User) -> SourceProposal:
    locked = _lock_editable_source_proposal(proposal=proposal, actor=actor)
    if locked.current_step != SourceProposalStep.PREVIEW or not locked.normalized_domain:
        raise ValidationError("ابتدا اطلاعات وب‌سایت را کامل کنید.")
    locked.preview = {
        "simulated": True,
        "title": "پیش‌نمایش شبیه‌سازی‌شده",
        "disclaimer": (
            "این نمونه فقط برای نمایش روند آینده ساخته شده و هیچ درخواست زنده‌ای "
            "به وب‌سایت شما ارسال نشده است."
        ),
        "estimated_count": None,
        "inventory_range": locked.inventory_range,
        "examples": [
            {"title": "نمونه ملک مسکونی", "status": "نیازمند بررسی اپراتور"},
            {"title": "نمونه ملک تجاری", "status": "نیازمند بررسی اپراتور"},
            {"title": "نمونه اطلاعات اجاره", "status": "نیازمند بررسی اپراتور"},
        ],
    }
    locked.preview_confirmed = False
    locked.save(update_fields=("preview", "preview_confirmed", "updated_at"))
    return locked


@transaction.atomic
def submit_source_proposal(*, proposal: SourceProposal, actor: User) -> SourceProposal:
    locked = _lock_editable_source_proposal(proposal=proposal, actor=actor)
    if not locked.preview or locked.preview.get("simulated") is not True:
        raise ValidationError("ابتدا پیش‌نمایش شبیه‌سازی‌شده را مشاهده کنید.")
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


class SourceProposalReviewConflict(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def _active_claim(proposal: SourceProposal) -> SourceProposalReviewClaim | None:
    return proposal.review_claims.filter(released_at__isnull=True).first()


def _ensure_not_representative(*, proposal: SourceProposal, actor: User) -> None:
    if proposal.submitter_id == actor.id:
        raise ValidationError("An Operator cannot decide their own Source Proposal.")


@transaction.atomic
def claim_source_proposal_review(
    *, proposal: SourceProposal, actor: User
) -> SourceProposalReviewClaim:
    proposal = SourceProposal.objects.select_for_update().get(id=proposal.id)
    _ensure_not_representative(proposal=proposal, actor=actor)
    if proposal.state != SourceProposalState.PENDING:
        raise ValidationError("Only a pending Source Proposal can be claimed.")
    now = timezone.now()
    claim = _active_claim(proposal)
    if claim is not None and claim.expires_at <= now:
        claim.released_at = now
        claim.save(update_fields=("released_at",))
        claim = None
    if claim is not None:
        if claim.operator_id == actor.id:
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


def _current_claim(
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
    claim = _active_claim(proposal)
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


@transaction.atomic
def request_source_proposal_changes(
    *, proposal: SourceProposal, actor: User, reviewed_revision: int, reason: str
) -> SourceProposal:
    proposal = SourceProposal.objects.select_for_update().get(id=proposal.id)
    _ensure_not_representative(proposal=proposal, actor=actor)
    claim = _current_claim(proposal=proposal, actor=actor, reviewed_revision=reviewed_revision)
    reason = reason.strip()
    if not reason:
        raise ValidationError("Request Changes requires a reason.")
    return _record_review_decision(
        proposal=proposal,
        actor=actor,
        claim=claim,
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
) -> SourceProposal:
    prior_state = proposal.state
    proposal.state = new_state
    proposal.pending_since = None
    proposal.save(update_fields=("state", "pending_since", "updated_at"))
    SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=actor,
        revision=proposal.revision,
        prior_state=prior_state,
        new_state=new_state,
        reason=reason,
    )
    claim.released_at = timezone.now()
    claim.save(update_fields=("released_at",))
    return proposal


@transaction.atomic
def reject_source_proposal(
    *, proposal: SourceProposal, actor: User, reviewed_revision: int, reason: str
) -> SourceProposal:
    proposal = SourceProposal.objects.select_for_update().get(id=proposal.id)
    _ensure_not_representative(proposal=proposal, actor=actor)
    claim = _current_claim(proposal=proposal, actor=actor, reviewed_revision=reviewed_revision)
    return _record_review_decision(
        proposal=proposal,
        actor=actor,
        claim=claim,
        new_state=SourceProposalState.REJECTED,
        reason=_required_reason(reason),
    )


@transaction.atomic
def approve_source_proposal(
    *, proposal: SourceProposal, actor: User, reviewed_revision: int, confirmed: bool
) -> SourceProposal:
    if not confirmed:
        raise ValidationError("Source approval requires confirmation.")
    proposal = SourceProposal.objects.select_for_update().get(id=proposal.id)
    _ensure_not_representative(proposal=proposal, actor=actor)
    claim = _current_claim(proposal=proposal, actor=actor, reviewed_revision=reviewed_revision)
    source, _ = Source.objects.get_or_create(
        domain=proposal.normalized_domain,
        defaults={
            "name": f"external-{proposal.id}",
            "display_name": proposal.website_name[:120],
            "outbound_policy": OutboundPolicy.EXTERNAL_LINK,
        },
    )
    proposal.source = source
    proposal.save(update_fields=("source", "updated_at"))
    return _record_review_decision(
        proposal=proposal,
        actor=actor,
        claim=claim,
        new_state=SourceProposalState.APPROVED,
    )
