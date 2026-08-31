import ipaddress
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User

from .models import SourceProposal, SourceProposalState, SourceProposalStep


class SourceProposalAccessDenied(Exception):
    pass


def _lock_editable_source_proposal(*, proposal: SourceProposal, actor: User) -> SourceProposal:
    locked = SourceProposal.objects.select_for_update().get(id=proposal.id)
    if locked.submitter_id != actor.id or locked.state != SourceProposalState.DRAFT:
        raise SourceProposalAccessDenied("این Source Proposal قابل ویرایش نیست.")
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
        .filter(submitter=submitter, state=SourceProposalState.DRAFT)
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
            state__in=(SourceProposalState.DRAFT, SourceProposalState.PENDING),
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
            state__in=(SourceProposalState.DRAFT, SourceProposalState.PENDING),
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
    locked.preview_confirmed = True
    locked.state = SourceProposalState.PENDING
    locked.pending_since = timezone.now()
    locked.save(update_fields=("preview_confirmed", "state", "pending_since", "updated_at"))
    return locked
