"""Assignment-authorized requests and fenced, bounded extraction executions."""

from collections.abc import Sequence
from dataclasses import asdict
from datetime import timedelta
from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Source
from apps.source_extraction.contract import ExtractionContract, ExtractionPage
from apps.source_extraction.discovery import PageKind
from apps.source_extraction.fetching import (
    FetchBatch,
    FetchFailure,
    FetchFailureCode,
    FetchRecord,
    SourcePageFetcher,
    validate_public_destination,
)
from apps.source_extraction.normalization import normalize_url

from .exclusions import matching_exclusion
from .models import (
    ExtractionRequest,
    ExtractionRun,
    ExtractionState,
    ProfileReviewMode,
    SourceAssignment,
    SourceProfile,
)
from .profiles import extractor_profile
from .publication_modes import publication_mode
from .url_validation import normalize_public_domain, normalize_public_url


@transaction.atomic
def submit_request(
    *, assignment_id: int, proposal_id: str, actor: User, url: str
) -> ExtractionRequest:
    assignment = SourceAssignment.objects.select_related("source").get(pk=assignment_id)
    Source.objects.select_for_update().get(pk=assignment.source_id)
    assignment.refresh_from_db()
    if (
        assignment.representative_id != actor.pk
        or str(assignment.proposal_id) != str(proposal_id)
        or assignment.revoked_at
        or assignment.proposal.state != "approved"
        or assignment.approval is None
        or assignment.source.profile.active_version_id != assignment.approval.version_id
    ):
        raise ValidationError("تخصیص یا پروفایل فعال در دسترس نیست.")
    canonical = normalize_public_url(url)
    if normalize_public_domain(canonical) != assignment.source.domain:
        raise ValidationError("نشانی باید روی دامنه دقیق منبع باشد.")
    if not validate_public_destination(canonical, approved_host=assignment.source.domain):
        raise ValidationError("مقصد عمومی امن در دسترس نیست؛ نشانی را بررسی یا دوباره تلاش کنید.")
    mode, revision = publication_mode(assignment.approval)
    request = ExtractionRequest.objects.create(
        assignment=assignment,
        requester=actor,
        profile_version=assignment.approval.version,
        review_mode=mode,
        publication_revision=revision,
        submitted_url=url,
        canonical_url=canonical,
    )
    from .tasks import extract_source

    transaction.on_commit(lambda: extract_source.delay(str(request.pk)))
    return request


PIPELINE_VERSION = "assignment-extraction-v1"
RECOVERY_DELAY = timedelta(minutes=12)
MAX_ATTEMPTS = 3


class AuthorizationEnded(Exception):
    pass


def authorization_error() -> dict[str, object]:
    return {
        "code": "authorization_ended",
        "detail": "تخصیص یا پروفایل تغییر کرده است.",
        "transient": False,
    }


def authorized(request: ExtractionRequest) -> bool:
    return (
        request.requester_id is not None
        and SourceAssignment.objects.filter(
            pk=request.assignment_id,
            revoked_at__isnull=True,
            representative_id=request.requester_id,
            approval__version_id=request.profile_version_id,
            proposal__state="approved",
        ).exists()
        and SourceProfile.objects.filter(
            source_id=request.assignment.source_id, active_version_id=request.profile_version_id
        ).exists()
    )


class AssignedSourceFetcher:
    def __init__(self, request: ExtractionRequest) -> None:
        self.request = request
        self.skipped: dict[str, dict[str, Any]] = {}
        self.requested_urls: dict[str, set[str]] = {}
        self.fetcher = SourcePageFetcher(approved_host=request.assignment.source.domain)

    def fetch(self, urls: Sequence[str], *, render: bool = False) -> FetchBatch:
        if not authorized(self.request):
            raise AuthorizationEnded
        excluded = [self.excluded_record(url) for url in urls]
        allowed = [url for url, skipped in zip(urls, excluded, strict=True) if skipped is None]
        # Keep the hardened adapter's per-batch bounds and concurrency limits intact.
        fetched = iter(self.fetcher.fetch(allowed, render=render).records if allowed else ())
        records = []
        for url, skipped in zip(urls, excluded, strict=True):
            if skipped:
                records.append(skipped)
                continue
            record = next(fetched)
            if record.page:
                final_url = normalize_url(record.page.url)
                self.requested_urls.setdefault(final_url, set()).add(url)
                # Both the requested and final URLs can be restricted while fetching.
                # Preserve actual unsuccessful responses as failure evidence.
                if record.page.status_code < 400:
                    record = self.excluded_record(url) or self.excluded_record(final_url) or record
            records.append(record)
        return FetchBatch(tuple(records))

    def excluded_record(self, url: str) -> FetchRecord | None:
        exclusion = matching_exclusion(self.request.assignment.source, url)
        if exclusion is None:
            return None
        self.skipped[url] = {
            "url": url,
            "exclusion_id": str(exclusion.pk),
            "reason": exclusion.reason,
        }
        return FetchRecord(
            url, failure=FetchFailure(FetchFailureCode.SOURCE_EXCLUDED, url, exclusion.reason)
        )


def run_extraction(request_id: str) -> bool:
    """Return whether delivery should retry; one run survives every bounded attempt."""
    initial = ExtractionRequest.objects.select_related("assignment").get(pk=request_id)
    with transaction.atomic():
        Source.objects.select_for_update().get(pk=initial.assignment.source_id)
        request = ExtractionRequest.objects.select_for_update().get(pk=request_id)
        if request.state in (ExtractionState.COMPLETE, ExtractionState.CANCELLED):
            return False
        run = ExtractionRun.objects.filter(request=request).first()
        if (
            run
            and run.state == ExtractionState.FAILED
            and (
                run.attempts >= MAX_ATTEMPTS or not any(error["transient"] for error in run.errors)
            )
        ):
            return False
        if (
            run
            and run.state == ExtractionState.RUNNING
            and run.started_at > timezone.now() - RECOVERY_DELAY
        ):
            return True
        if run and run.attempts >= MAX_ATTEMPTS:
            run.state = ExtractionState.FAILED
            run.completed_at = timezone.now()
            run.errors = [
                {
                    "code": "attempts_exhausted",
                    "detail": "تلاش‌ها پایان یافت؛ درخواست تازه ثبت کنید.",
                    "transient": True,
                }
            ]
            run.save()
            request.state = run.state
            request.save(update_fields=("state", "updated_at"))
            return False
        if run is None:
            run = ExtractionRun.objects.create(
                request=request,
                profile_version=request.profile_version,
                pipeline_version=PIPELINE_VERSION,
                started_at=timezone.now(),
            )
        else:
            run.attempts += 1
            run.started_at = timezone.now()
            run.completed_at = None
        run.state = ExtractionState.RUNNING
        run.save()
        request.state = ExtractionState.RUNNING
        request.save(update_fields=("state", "updated_at"))
        attempt = run.attempts
    results = []
    skipped_pages: list[dict[str, Any]] = []
    withdrawals: list[dict[str, Any]] = []
    errors = []
    discovered = failed = rejected = 0
    state = ExtractionState.COMPLETE
    try:
        if not authorized(request):
            raise AuthorizationEnded
        from .extraction_availability import unavailable_reason

        fetcher = AssignedSourceFetcher(request)
        contract = ExtractionContract(fetcher, max_pages=20, max_depth=2)
        discovery = contract.discover(request.canonical_url)
        pages = []
        skipped_pages = list(fetcher.skipped.values())
        for page in discovery.pages:
            if page.fetch_failure and page.fetch_failure.code == FetchFailureCode.SOURCE_EXCLUDED:
                continue
            if normalize_public_domain(page.url) != request.assignment.source.domain:
                raise AuthorizationEnded
            reason = unavailable_reason(page, fetcher)
            if reason:
                withdrawals.append({
                    "url": page.url,
                    "reason": reason,
                    "requested_urls": sorted(fetcher.requested_urls.get(page.url, {page.url})),
                })
            if (
                not reason
                and page.classification.kind == PageKind.RENTAL_LISTING
                and page.sanitized_html is not None
            ):
                pages.append(ExtractionPage(page.url, page.sanitized_html))
            if page.fetch_failure:
                failed += 1
                errors.append({
                    "code": page.fetch_failure.code,
                    "url": page.url,
                    "detail": "دریافت صفحه ناموفق بود.",
                    "transient": page.fetch_failure.transient,
                })
            elif page.classification.kind == PageKind.FETCH_ERROR:
                failed += 1
                errors.append({
                    "code": "unsupported_response",
                    "url": page.url,
                    "detail": "پاسخ صفحه قابل پردازش نبود.",
                    "transient": page.http_status is None
                    or page.http_status == 429
                    or page.http_status >= 500,
                })
            elif page.classification.kind == PageKind.BLOCKED:
                rejected += 1
        discovered = len(pages)
        if not authorized(request):
            raise AuthorizationEnded
        results = [
            {
                **asdict(result),
                "requested_urls": sorted(fetcher.requested_urls.get(page.url, {page.url})),
            }
            for page, result in zip(
                pages,
                contract.apply_profile(extractor_profile(request.profile_version), pages),
                strict=True,
            )
        ]
        results = list({result["canonical_url"]: result for result in results}.values())
        # Canonical identities must stay inside the same authorization boundary.
        for result in results:
            if normalize_public_domain(result["canonical_url"]) != request.assignment.source.domain:
                raise AuthorizationEnded
        if failed and not pages:
            state = ExtractionState.FAILED
    except AuthorizationEnded:
        state = ExtractionState.CANCELLED
        results = []
        errors = [authorization_error()]
    except Exception:
        state = ExtractionState.FAILED
        failed = max(failed, 1)
        errors = [
            {"code": "extraction_failed", "detail": "استخراج موقتاً ناموفق بود.", "transient": True}
        ]
    with transaction.atomic():
        Source.objects.select_for_update().get(pk=request.assignment.source_id)
        request = ExtractionRequest.objects.select_for_update().get(pk=request_id)
        run = ExtractionRun.objects.get(request=request)
        if run.attempts != attempt or run.state != ExtractionState.RUNNING:
            return False
        if not authorized(request):
            state = ExtractionState.CANCELLED
            results = []
            errors = [authorization_error()]
        run.state = state
        run.completed_at = timezone.now()
        run.discovered = discovered
        run.extracted = len(results)
        run.needs_attention = sum(
            bool(result["unresolved"] or result["conflicts"] or result["structural_drift"])
            for result in results
        )
        run.rejected = rejected
        run.failed = failed
        run.results = results
        run.skipped_pages = skipped_pages
        run.withdrawals = (
            [
                evidence
                for evidence in withdrawals
                if not any(
                    matching_exclusion(request.assignment.source, url, since=request.created_at)
                    for url in (evidence["url"], *evidence.get("requested_urls", []))
                )
            ]
            if state != ExtractionState.CANCELLED
            else []
        )
        run.errors = errors[:20]
        run.save()
        if state == ExtractionState.COMPLETE:
            from .candidate_publication import create_run_candidates

            create_run_candidates(run)
            if request.review_mode == ProfileReviewMode.AUTOMATIC:
                from .candidate_publication import publish_automatic_candidates

                publish_automatic_candidates(run)
        if run.withdrawals:
            from .extraction_availability import withdraw_listings

            withdraw_listings(run)
        request.state = state
        request.save(update_fields=("state", "updated_at"))
        return (
            state == ExtractionState.FAILED
            and run.attempts < MAX_ATTEMPTS
            and any(error["transient"] for error in errors)
        )
