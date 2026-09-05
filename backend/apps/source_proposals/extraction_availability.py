"""Positive availability evidence; bounded Discovery absence is never evidence."""

from bs4 import BeautifulSoup

from apps.catalog.models import Listing, ListingState
from apps.catalog.services import mark_listing_unavailable
from apps.source_extraction.contract import DiscoveryPage, PageFetcher
from apps.source_extraction.normalization import normalize_text, normalize_url

from .models import ExtractionRun

UNAVAILABLE_HEADINGS = {
    "این آگهی دیگر در دسترس نیست",
    "این آگهی حذف شده است",
    "این ملک اجاره داده شده است",
    "آگهی منقضی شده است",
    "This listing is no longer available",
}


def unavailable_reason(page: DiscoveryPage, fetcher: PageFetcher) -> str | None:
    if page.fetch_failure:
        return None
    if page.http_status == 410:
        return "http_410"
    if page.http_status == 404:
        # A second independent response confirms that a transient edge/cache miss is durable.
        confirmation = fetcher.fetch([page.url])
        if any(
            record.page
            and record.page.status_code in (404, 410)
            and normalize_url(record.page.url) == normalize_url(page.url)
            for record in confirmation.records
        ):
            return "confirmed_http_404"
    if page.http_status == 200 and page.sanitized_html:
        soup = BeautifulSoup(page.sanitized_html, "html.parser")
        heading = soup.select_one("main h1, article h1, body > h1")
        if heading and normalize_text(heading.get_text(" ", strip=True)) in UNAVAILABLE_HEADINGS:
            return "explicit_unavailable"
    return None


def withdraw_listings(run: ExtractionRun) -> None:
    for evidence in run.withdrawals:
        listing = Listing.objects.filter(
            source=run.request.assignment.source,
            external_url=evidence["url"],
            state=ListingState.PUBLISHED,
        ).first()
        if listing:
            mark_listing_unavailable(listing)
            evidence["listing_id"] = str(listing.pk)
    run.save(update_fields=("withdrawals",))
