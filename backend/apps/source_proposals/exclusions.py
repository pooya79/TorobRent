"""Reasoned Source restrictions, independent of profile validation evidence."""

from datetime import datetime
from typing import Any, cast
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.accounts.models import User
from apps.catalog.models import Listing, Source
from apps.source_extraction.normalization import normalize_url

from .models import (
    ExternalListingCandidate,
    ExtractionRequest,
    ExtractionRun,
    SourceAssignment,
    SourceExclusion,
    SourceExclusionAction,
    SourceProfileVersion,
    SourceProposal,
    SourceReservation,
)
from .responsibility import require_source_responsibility
from .url_validation import normalize_public_domain, normalize_public_url


def normalized_rule(*, source: Source, kind: str, url: str) -> str:
    canonical = normalize_url(normalize_public_url(url))
    if normalize_public_domain(canonical) != source.domain:
        raise ValidationError("نشانی باید روی دامنه دقیق منبع باشد.")
    if kind not in ("exact", "path_prefix"):
        raise ValidationError("نوع محدودیت معتبر نیست.")
    if kind == "path_prefix" and urlsplit(canonical).query:
        raise ValidationError("برای بخش مسیر، نشانی بدون پارامتر وارد کنید.")
    return canonical


def matches(*, domain: str, kind: str, pattern: str, url: str) -> bool:
    try:
        canonical = normalize_url(normalize_public_url(url))
    except ValidationError:
        return False
    if normalize_public_domain(canonical) != domain:
        return False
    if kind == "exact":
        return canonical == pattern
    path = urlsplit(canonical).path
    prefix = urlsplit(pattern).path.rstrip("/")
    return path == prefix or path.startswith(prefix + "/")


def require_exclusion_authority(proposal: SourceProposal, actor: User) -> Source:
    source = require_source_responsibility(proposal=proposal, actor=actor)
    if (
        source is None
        or not SourceAssignment.objects.filter(
            proposal=proposal, source=source, revoked_at__isnull=True
        ).exists()
    ):
        raise ValidationError("تخصیص فعال منبع لازم است.")
    return source


def preview_matches(*, source: Source, kind: str, url: str) -> dict[str, Any]:
    known = set(
        ExternalListingCandidate.objects.filter(source=source).values_list(
            "external_url", flat=True
        )
    )
    known.update(
        ExtractionRequest.objects.filter(assignment__source=source).values_list(
            "canonical_url", flat=True
        )
    )
    for run in ExtractionRun.objects.filter(request__assignment__source=source):
        known.update(
            item["url"]
            for item in [*run.errors, *run.skipped_pages, *run.withdrawals]
            if "url" in item
        )
        known.update(url for item in run.results for url in item.get("requested_urls", []))
    for version in SourceProfileVersion.objects.filter(profile__source=source):
        known.update(sample["canonical_url"] for sample in version.samples)
        known.update(version.exclusions)
    for reservation in SourceReservation.objects.filter(source=source):
        known.update(sample["url"] for sample in reservation.evidence.get("samples", []))
    listings = []
    for listing in Listing.objects.filter(source=source, state="published").order_by("id"):
        known.add(listing.external_url)
        if listing_matches(listing, source=source, kind=kind, pattern=url):
            listings.append({"id": str(listing.pk), "url": listing.external_url})
    pages = sorted({
        normalize_url(normalize_public_url(page))
        for page in known
        if matches(domain=source.domain, kind=kind, pattern=url, url=page)
    })
    return {
        "kind": kind,
        "url": url,
        "known_pages": pages[:100],
        "published_listings": listings[:100],
        "known_page_count": len(pages),
        "published_listing_count": len(listings),
    }


@transaction.atomic
def preview_exclusion(
    *, proposal: SourceProposal, actor: User, kind: str, url: str
) -> dict[str, Any]:
    source = require_exclusion_authority(proposal, actor)
    return preview_matches(
        source=source, kind=kind, url=normalized_rule(source=source, kind=kind, url=url)
    )


def matching_exclusion(
    source: Source, url: str, *, since: datetime | None = None
) -> SourceExclusion | None:
    """A run retains holds even if a restriction is removed while it is in flight."""
    for rule in SourceExclusion.objects.filter(source=source).prefetch_related("actions"):
        removal = next((a for a in rule.actions.all() if a.action == "remove"), None)
        if removal is not None and (since is None or removal.created_at < since):
            continue
        if matches(domain=source.domain, kind=rule.kind, pattern=rule.url, url=url):
            return cast(SourceExclusion, rule)
    return None


def require_confirmation(reason: str, confirmed: bool) -> str:
    if not confirmed or not reason.strip():
        raise ValidationError("دلیل و تأیید صریح لازم است.")
    return reason.strip()


@transaction.atomic
def add_exclusion(
    *, proposal: SourceProposal, actor: User, kind: str, url: str, reason: str, confirmed: bool
) -> SourceProposal:
    source = require_exclusion_authority(proposal, actor)
    reason = require_confirmation(reason, confirmed)
    url = normalized_rule(source=source, kind=kind, url=url)
    if (
        SourceExclusion.objects
        .filter(source=source, kind=kind, url=url)
        .exclude(actions__action="remove")
        .exists()
    ):
        raise ValidationError("این محدودیت از قبل فعال است.")
    exclusion = SourceExclusion.objects.create(
        source=source, actor=actor, kind=kind, url=url, reason=reason
    )
    for candidate in ExternalListingCandidate.objects.filter(
        source=source, state__in=("pending", "changes_requested"), exclusion_hold__isnull=True
    ):
        if any(
            matches(domain=source.domain, kind=kind, pattern=url, url=page_url)
            for page_url in candidate_page_urls(candidate)
        ):
            candidate.exclusion_hold = exclusion
            candidate.save(update_fields=("exclusion_hold", "updated_at"))
    return proposal


@transaction.atomic
def remove_exclusion(
    *, proposal: SourceProposal, actor: User, exclusion_id: str, reason: str, confirmed: bool
) -> SourceProposal:
    source = require_exclusion_authority(proposal, actor)
    reason = require_confirmation(reason, confirmed)
    exclusion = (
        SourceExclusion.objects
        .filter(source=source, pk=exclusion_id)
        .exclude(actions__action="remove")
        .first()
    )
    if exclusion is None:
        raise ValidationError("محدودیت فعال پیدا نشد؛ پرونده را تازه کنید.")
    SourceExclusionAction.objects.create(
        exclusion=exclusion, actor=actor, action="remove", reason=reason
    )
    return proposal


@transaction.atomic
def withdraw_excluded_listings(
    *,
    proposal: SourceProposal,
    actor: User,
    exclusion_id: str,
    reason: str,
    confirmed: bool,
    listing_ids: list[str],
) -> SourceProposal:
    from apps.catalog.services import mark_listing_unavailable

    source = require_exclusion_authority(proposal, actor)
    reason = require_confirmation(reason, confirmed)
    exclusion = (
        SourceExclusion.objects
        .filter(source=source, pk=exclusion_id)
        .exclude(actions__action="remove")
        .first()
    )
    if exclusion is None:
        raise ValidationError("محدودیت فعال پیدا نشد؛ پرونده را تازه کنید.")
    listings = list(
        Listing.objects
        .select_for_update()
        .filter(source=source, state="published", pk__in=listing_ids)
        .order_by("id")
    )
    if (
        not listings
        or len(listings) != len(listing_ids)
        or any(
            not listing_matches(listing, source=source, kind=exclusion.kind, pattern=exclusion.url)
            for listing in listings
        )
    ):
        raise ValidationError("آگهی‌ها تغییر کرده است؛ پیش‌نمایش را تازه کنید.")
    for listing in listings:
        mark_listing_unavailable(listing)
    SourceExclusionAction.objects.create(
        exclusion=exclusion,
        actor=actor,
        action="withdraw",
        reason=reason,
        listing_ids=[str(listing.pk) for listing in listings],
    )
    return proposal


def blocking_exclusion(candidate: ExternalListingCandidate) -> SourceExclusion | None:
    hold = candidate.exclusion_hold
    if hold and not hold.actions.filter(action="remove").exists():
        return hold
    return candidate_exclusion(candidate)


def candidate_page_urls(candidate: ExternalListingCandidate) -> set[str]:
    urls = {candidate.external_url}
    if candidate.extraction_run is not None:
        for result in candidate.extraction_run.results:
            if result["canonical_url"] == candidate.external_url:
                urls.update(result.get("requested_urls", []))
    return urls


def candidate_exclusion(
    candidate: ExternalListingCandidate, *, since: datetime | None = None
) -> SourceExclusion | None:
    for url in sorted(candidate_page_urls(candidate)):
        exclusion = matching_exclusion(candidate.source, url, since=since)
        if exclusion:
            return exclusion
    return None


def listing_matches(listing: Listing, *, source: Source, kind: str, pattern: str) -> bool:
    urls = {listing.external_url}
    # Only the Listing's current evidence determines its redirected page identity.
    for candidate in listing.external_candidates.select_related("extraction_run").all():
        if str(candidate.pk) == listing.source_reference:
            urls.update(candidate_page_urls(candidate))
    return any(matches(domain=source.domain, kind=kind, pattern=pattern, url=url) for url in urls)
