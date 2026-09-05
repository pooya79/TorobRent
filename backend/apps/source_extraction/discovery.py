from __future__ import annotations

import json
import re
from dataclasses import dataclass
from enum import StrEnum
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

from apps.source_extraction.normalization import normalize_text, normalize_url

RENTAL_TERMS = {
    "اجاره",
    "رهن",
    "ودیعه",
    "rent",
    "rental",
    "lease",
}
PROPERTY_TERMS = {
    "آپارتمان",
    "خانه",
    "ویلا",
    "ملک",
    "متراژ",
    "apartment",
    "house",
    "villa",
    "property",
}
SALE_TERMS = {"فروش", "خرید", "sale", "buy"}
DETAIL_TERMS = {
    "اجاره ماهانه",
    "ودیعه",
    "متراژ",
    "تعداد اتاق",
    "اتاق خواب",
    "سال ساخت",
    "طبقه",
    "پارکینگ",
    "آسانسور",
    "شناسه آگهی",
    "کد آگهی",
    "listing id",
}
CONTACT_TERMS = {"تماس", "شماره تماس", "اطلاعات تماس", "contact", "phone"}
IRRELEVANT_TERMS = {"ورود", "ثبت نام", "درباره", "اخبار", "login", "register", "news"}
SKIPPED_SUFFIXES = {
    ".css",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".json",
    ".pdf",
    ".png",
    ".svg",
    ".webp",
    ".xml",
    ".zip",
}


class PageKind(StrEnum):
    RENTAL_LISTING = "rental_listing"
    RENTAL_INDEX = "rental_index"
    OTHER_PROPERTY = "other_property"
    IRRELEVANT = "irrelevant"
    BLOCKED = "blocked"
    FETCH_ERROR = "fetch_error"


@dataclass(frozen=True)
class PageClassification:
    kind: PageKind
    confidence: float
    score: int
    evidence: tuple[str, ...]


@dataclass(frozen=True)
class CandidateLink:
    url: str
    anchor_text: str
    score: int
    is_structured_listing: bool = False


def _contains_any(text: str, terms: set[str]) -> bool:
    return any(term in text for term in terms)


def _structured_listing_links(page_url: str, soup: BeautifulSoup) -> list[tuple[str, str]]:
    listing_types = {
        "accommodation",
        "apartment",
        "house",
        "offer",
        "product",
        "realestatelisting",
        "residence",
        "singlefamilyresidence",
    }
    origin = urlsplit(page_url).netloc
    links: dict[str, str] = {}

    def visit(value: object) -> None:
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if not isinstance(value, dict):
            return

        raw_types = value.get("@type", ())
        if isinstance(raw_types, str):
            types = {raw_types.casefold()}
        elif isinstance(raw_types, list):
            types = {str(item).casefold() for item in raw_types}
        else:
            types = set()
        raw_url = value.get("url")
        if types & listing_types and isinstance(raw_url, str):
            absolute_url = normalize_url(urljoin(page_url, raw_url))
            if urlsplit(absolute_url).netloc == origin:
                web_info = value.get("web_info")
                web_title = web_info.get("title", "") if isinstance(web_info, dict) else ""
                title = str(value.get("name") or web_title)
                links[absolute_url] = normalize_text(title)

        for nested in value.values():
            if isinstance(nested, (dict, list)):
                visit(nested)

    for script in soup.find_all("script", type="application/ld+json"):
        try:
            visit(json.loads(script.string or ""))
        except json.JSONDecodeError, TypeError:
            continue
    return list(links.items())


def _listing_like_link_count(soup: BeautifulSoup) -> int:
    matches = 0
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href", ""))
        text = normalize_text(anchor.get_text(" ", strip=True)).casefold()
        if re.search(r"(?:^|[-/])\d{4,}(?:$|[/?#-])", href) or _contains_any(text, PROPERTY_TERMS):
            matches += 1
    return matches


def classify_page(url: str, html: str) -> PageClassification:
    """Classify a fetched page using explainable, site-agnostic signals."""
    soup = BeautifulSoup(html, "html.parser")
    structured_listing_count = len(_structured_listing_links(url, soup))
    for element in soup(["script", "style", "noscript"]):
        element.decompose()
    visible_text = normalize_text(soup.get_text(" ", strip=True)).casefold()

    rental_signal = _contains_any(visible_text, RENTAL_TERMS)
    property_signal = _contains_any(visible_text, PROPERTY_TERMS)
    sale_signal = _contains_any(visible_text, SALE_TERMS)
    detail_hits = sorted(term for term in DETAIL_TERMS if term in visible_text)
    has_contact = _contains_any(visible_text, CONTACT_TERMS)
    h1_count = len(soup.find_all("h1"))
    listing_link_count = _listing_like_link_count(soup)

    detail_score = 0
    index_score = 0
    evidence: list[str] = []
    if rental_signal:
        detail_score += 2
        evidence.append("Rental terminology is present")
    if detail_hits:
        detail_score += min(len(detail_hits), 4)
        evidence.append(f"Property details found: {', '.join(detail_hits[:4])}")
    if has_contact:
        detail_score += 1
        evidence.append("A contact action is present")
    if h1_count == 1:
        detail_score += 1
        evidence.append("The page has one primary heading")
    if listing_link_count >= 3:
        index_score += 4
        evidence.append(f"The page links to {listing_link_count} listing-like pages")
    elif listing_link_count:
        index_score += 1
    if structured_listing_count >= 3:
        index_score += min(10, 5 + structured_listing_count // 5)
        evidence.append(
            f"Structured data references {structured_listing_count} individual listings"
        )

    if rental_signal and structured_listing_count >= 3:
        kind = PageKind.RENTAL_INDEX
        score = index_score
    elif rental_signal and detail_score >= 5 and detail_score > index_score:
        kind = PageKind.RENTAL_LISTING
        score = detail_score
    elif rental_signal and index_score >= 3:
        kind = PageKind.RENTAL_INDEX
        score = index_score
    elif property_signal or sale_signal:
        kind = PageKind.OTHER_PROPERTY
        score = max(detail_score, 1)
        evidence.append("The page is property-related but not a rental listing")
    else:
        kind = PageKind.IRRELEVANT
        score = 0
        evidence.append("No reliable rental-property signals were found")

    confidence = min(0.98, 0.55 + (abs(detail_score - index_score) * 0.07))
    return PageClassification(
        kind=kind, confidence=confidence, score=score, evidence=tuple(evidence)
    )


def extract_candidate_links(
    page_url: str, html: str, *, preferred_terms: tuple[str, ...] = ()
) -> list[CandidateLink]:
    """Return unique, same-origin HTML links with a transparent relevance score."""
    soup = BeautifulSoup(html, "html.parser")
    origin = urlsplit(page_url)
    candidates: dict[str, CandidateLink] = {}

    for anchor in soup.find_all("a", href=True):
        raw_href = str(anchor.get("href", "")).strip()
        if not raw_href or raw_href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        absolute_url = normalize_url(urljoin(page_url, raw_href))
        parts = urlsplit(absolute_url)
        if parts.scheme not in {"http", "https"} or parts.netloc != origin.netloc:
            continue
        if any(parts.path.casefold().endswith(suffix) for suffix in SKIPPED_SUFFIXES):
            continue

        anchor_text = normalize_text(anchor.get_text(" ", strip=True))
        signal_text = f"{parts.path} {parts.query} {anchor_text}".casefold()
        score = 0
        if _contains_any(signal_text, RENTAL_TERMS):
            score += 5
        if _contains_any(signal_text, PROPERTY_TERMS):
            score += 2
        if any(term.casefold() in signal_text for term in preferred_terms):
            score += 4
        if re.search(r"(?:^|[-/])\d{4,}(?:$|[/?#-])", parts.path):
            score += 2
        if _contains_any(signal_text, SALE_TERMS):
            score -= 4
        if _contains_any(signal_text, IRRELEVANT_TERMS):
            score -= 6

        existing = candidates.get(absolute_url)
        if existing is None or score > existing.score:
            candidates[absolute_url] = CandidateLink(absolute_url, anchor_text, score)

    for structured_url, title in _structured_listing_links(page_url, soup):
        signal_text = f"{urlsplit(structured_url).path} {title}".casefold()
        score = 3
        if _contains_any(signal_text, RENTAL_TERMS):
            score += 5
        if _contains_any(signal_text, PROPERTY_TERMS):
            score += 2
        if any(term.casefold() in signal_text for term in preferred_terms):
            score += 4
        existing = candidates.get(structured_url)
        if existing is None or score > existing.score:
            candidates[structured_url] = CandidateLink(
                structured_url,
                title,
                score,
                is_structured_listing=True,
            )

    return sorted(candidates.values(), key=lambda candidate: (-candidate.score, candidate.url))
