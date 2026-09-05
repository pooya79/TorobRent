from __future__ import annotations

import hashlib
import heapq
import json
import math
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from importlib.resources import files
from itertools import count
from typing import Any, Protocol
from urllib.parse import urlsplit

from .discovery import (
    PageClassification,
    PageKind,
    classify_page,
    extract_candidate_links,
)
from .fetching import FetchBatch, FetchFailure, FetchRecord
from .normalization import normalize_url
from .observations import (
    ALL_FIELDS,
    CORE_FIELDS,
    ApprovedProfileObserver,
    DomLabelObserver,
    FieldCandidate,
    LocationObserver,
    MetadataObserver,
    PersianTextObserver,
    StructuredDataObserver,
    TehranLocation,
    build_deterministic_profile,
    dom_fingerprint,
    fingerprint_centroid,
    fingerprint_similarity,
    looks_like_javascript_shell,
    normalize_url_shape,
    redact_candidate,
    redact_phone_numbers,
    resolve_candidates,
)

PROFILE_VALIDATION_RATIO = 0.8
STRUCTURE_SIMILARITY = 0.82
DRIFT_SIMILARITY = 0.80


class PageFetcher(Protocol):
    """The hardened fetching boundary consumed by the extraction contract."""

    def fetch(self, urls: Sequence[str], *, render: bool = False) -> FetchBatch: ...


class ExtractionContractError(RuntimeError):
    """The controlled input cannot produce a trustworthy Source Profile."""


@dataclass(frozen=True, slots=True)
class DiscoveryPage:
    url: str
    classification: PageClassification
    depth: int
    discovered_from: str | None
    link_score: int
    sanitized_html: str | None
    rendering_method: str | None
    fetch_failure: FetchFailure | None = None


@dataclass(frozen=True, slots=True)
class StructureGroup:
    fingerprint: str
    representative_url_shape: str
    page_urls: tuple[str, ...]
    supported_page_urls: tuple[str, ...]
    excluded_page_urls: tuple[str, ...]
    coverage: float
    selected: bool


@dataclass(frozen=True, slots=True)
class SourceDiscovery:
    seed_url: str
    pages: tuple[DiscoveryPage, ...]
    structures: tuple[StructureGroup, ...]
    dominant_fingerprint: str | None
    detail_page_count: int
    excluded_detail_page_urls: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class FieldEvidence:
    observer_name: str
    raw_value: Any
    normalized_value: Any
    confidence: float
    source_locator: str
    evidence_snippet: str
    disposition: str


@dataclass(frozen=True, slots=True)
class FieldValidation:
    resolved: int
    conflicts: int
    coverage: float
    passed: bool
    missing_page_urls: tuple[str, ...]
    conflict_page_urls: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ValidationPage:
    url: str
    status: str
    unresolved: tuple[str, ...]
    conflicts: Mapping[str, tuple[Any, ...]]
    evidence: Mapping[str, tuple[FieldEvidence, ...]]


@dataclass(frozen=True, slots=True)
class ProfileValidation:
    training_page_urls: tuple[str, ...]
    held_out_page_urls: tuple[str, ...]
    required_resolved: int
    fields: Mapping[str, FieldValidation]
    pages: tuple[ValidationPage, ...]
    approval_enabled: bool


@dataclass(frozen=True, slots=True)
class SourceProfile:
    mapping: Mapping[str, Any]
    structural_fingerprint: str
    mapping_diagnostics: Mapping[str, Any]
    validation: ProfileValidation
    profile_version: str = "deterministic-profile-v1"


@dataclass(frozen=True, slots=True)
class ExtractionPage:
    url: str
    html: str


@dataclass(frozen=True, slots=True)
class ExtractedListing:
    canonical_url: str
    normalized: Mapping[str, Any]
    source_claims: Mapping[str, tuple[Any, ...]]
    evidence: Mapping[str, tuple[FieldEvidence, ...]]
    conflicts: Mapping[str, tuple[Any, ...]]
    unresolved: tuple[str, ...]
    status: str
    structural_drift: bool
    fingerprint_similarity: float


@dataclass(frozen=True, slots=True)
class ExtractionOutcome:
    discovery: SourceDiscovery
    profile: SourceProfile
    listings: tuple[ExtractedListing, ...]


@dataclass(frozen=True, slots=True)
class _ProfilePage:
    url: str
    html: str
    fingerprint: str

    def as_legacy_mapping(self, identifier: int) -> dict[str, Any]:
        return {"id": identifier, "final_url": self.url, "html": self.html}


def load_tehran_locations() -> list[TehranLocation]:
    path = files("apps.source_extraction").joinpath("tehran_locations.v1.json")
    payload = json.loads(path.read_text(encoding="utf-8"))
    return [TehranLocation(**item) for item in payload["locations"]]


class ExtractionContract:
    """Discover, train, validate, and extract through one persistence-free API."""

    def __init__(
        self,
        fetcher: PageFetcher,
        *,
        locations: Sequence[TehranLocation] | None = None,
        max_pages: int = 50,
        target_detail_pages: int | None = None,
        max_depth: int = 2,
        preferred_location_terms: tuple[str, ...] = ("تهران", "tehran"),
    ) -> None:
        if not 1 <= max_pages <= 50:
            raise ValueError("max_pages must be between 1 and 50")
        resolved_target = min(30, max_pages) if target_detail_pages is None else target_detail_pages
        if not 1 <= resolved_target <= max_pages:
            raise ValueError("target_detail_pages must be between 1 and max_pages")
        if not 0 <= max_depth <= 5:
            raise ValueError("max_depth must be between 0 and 5")
        self._fetcher = fetcher
        self._location_observer = LocationObserver(list(locations or load_tehran_locations()))
        self._max_pages = max_pages
        self._target_detail_pages = resolved_target
        self._max_depth = max_depth
        self._preferred_location_terms = preferred_location_terms

    def discover(self, seed_url: str) -> SourceDiscovery:
        canonical_seed = normalize_url(seed_url)
        seed_host = urlsplit(canonical_seed).netloc.casefold()
        frontier: list[tuple[int, int, str, int, str | None, PageKind | None]] = []
        sequence = count()
        heapq.heappush(frontier, (-100, next(sequence), canonical_seed, 0, None, None))
        visited: set[str] = set()
        pages: list[DiscoveryPage] = []
        details = 0

        while frontier and len(visited) < self._max_pages and details < self._target_detail_pages:
            negative_score, _order, url, depth, parent, kind_hint = heapq.heappop(frontier)
            if url in visited:
                continue
            visited.add(url)
            record, rendering_method = self._fetch(url)
            if record.failure is not None or record.page is None:
                pages.append(
                    DiscoveryPage(
                        url=url,
                        classification=PageClassification(
                            PageKind.FETCH_ERROR,
                            1.0,
                            0,
                            (record.failure.detail if record.failure else "Fetch failed",),
                        ),
                        depth=depth,
                        discovered_from=parent,
                        link_score=-negative_score,
                        sanitized_html=None,
                        rendering_method=None,
                        fetch_failure=record.failure,
                    )
                )
                continue

            fetched = record.page
            html = fetched.body.decode("utf-8", errors="replace")
            content_type = next(
                (
                    value
                    for name, value in fetched.headers.items()
                    if name.casefold() == "content-type"
                ),
                "text/html",
            )
            if fetched.status_code >= 400 or "html" not in content_type.casefold():
                classification = PageClassification(
                    PageKind.FETCH_ERROR,
                    1.0,
                    0,
                    (f"Unsupported response: HTTP {fetched.status_code} with {content_type}",),
                )
            else:
                classification = classify_page(fetched.url, html)
                if kind_hint is not None and classification.kind is PageKind.IRRELEVANT:
                    classification = PageClassification(
                        kind_hint,
                        0.9,
                        max(classification.score, 5),
                        (
                            "A rental index identified this structured listing URL",
                            "The detail response did not independently expose enough signals",
                        ),
                    )

            retained_html = redact_phone_numbers(html)
            page = DiscoveryPage(
                url=normalize_url(fetched.url),
                classification=classification,
                depth=depth,
                discovered_from=parent,
                link_score=-negative_score,
                sanitized_html=retained_html,
                rendering_method=rendering_method,
            )
            pages.append(page)
            if classification.kind is PageKind.RENTAL_LISTING:
                details += 1
            if depth >= self._max_depth or classification.kind in {
                PageKind.RENTAL_LISTING,
                PageKind.FETCH_ERROR,
            }:
                continue
            minimum_score = 0 if classification.kind is PageKind.RENTAL_INDEX else 4
            for candidate in extract_candidate_links(
                fetched.url,
                html,
                preferred_terms=self._preferred_location_terms,
            ):
                if (
                    candidate.score < minimum_score
                    or urlsplit(candidate.url).netloc.casefold() != seed_host
                ):
                    continue
                heapq.heappush(
                    frontier,
                    (
                        -candidate.score,
                        next(sequence),
                        candidate.url,
                        depth + 1,
                        page.url,
                        (
                            PageKind.RENTAL_LISTING
                            if classification.kind is PageKind.RENTAL_INDEX
                            and candidate.is_structured_listing
                            else None
                        ),
                    ),
                )

        structures, dominant = self._group_structures(pages)
        selected_urls = next(
            (set(group.supported_page_urls) for group in structures if group.selected), set()
        )
        all_details = [
            page.url for page in pages if page.classification.kind is PageKind.RENTAL_LISTING
        ]
        return SourceDiscovery(
            seed_url=canonical_seed,
            pages=tuple(pages),
            structures=structures,
            dominant_fingerprint=dominant,
            detail_page_count=len(all_details),
            excluded_detail_page_urls=tuple(url for url in all_details if url not in selected_urls),
        )

    def propose_profile(
        self,
        discovery: SourceDiscovery,
        *,
        training_page_count: int = 5,
        validation_page_count: int = 5,
    ) -> SourceProfile:
        if training_page_count < 1 or validation_page_count < 1:
            raise ValueError("training and validation page counts must be positive")
        required = training_page_count + validation_page_count
        if discovery.dominant_fingerprint is None:
            raise ExtractionContractError("No supported rental-detail structure was discovered")
        selected = next(group for group in discovery.structures if group.selected)
        selected_urls = set(selected.supported_page_urls)
        candidates = [
            _ProfilePage(page.url, page.sanitized_html, dom_fingerprint(page.sanitized_html))
            for page in discovery.pages
            if page.url in selected_urls and page.sanitized_html is not None
        ]
        if len(candidates) < required:
            raise ExtractionContractError(
                f"Profile creation needs {required} pages in the dominant supported structure; "
                f"found {len(candidates)} of {discovery.detail_page_count} detail pages"
            )
        representatives = sorted(
            candidates, key=lambda page: hashlib.sha256(page.html.encode()).hexdigest()
        )[:required]
        training = representatives[:training_page_count]
        held_out = representatives[training_page_count:]
        training_mappings = [page.as_legacy_mapping(index) for index, page in enumerate(training)]
        mapping, diagnostics = build_deterministic_profile(training_mappings)
        validation = self._validate_profile(mapping, training, held_out)
        return SourceProfile(
            mapping=mapping,
            structural_fingerprint=discovery.dominant_fingerprint,
            mapping_diagnostics=diagnostics,
            validation=validation,
        )

    def apply_profile(
        self, profile: SourceProfile, pages: Sequence[ExtractionPage]
    ) -> tuple[ExtractedListing, ...]:
        profile_observer = ApprovedProfileObserver(dict(profile.mapping))
        output: list[ExtractedListing] = []
        for page in pages:
            sanitized_html = redact_phone_numbers(page.html)
            similarity = fingerprint_similarity(
                dom_fingerprint(sanitized_html), profile.structural_fingerprint
            )
            if similarity < DRIFT_SIMILARITY:
                output.append(
                    ExtractedListing(
                        canonical_url=normalize_url(page.url),
                        normalized={},
                        source_claims={},
                        evidence={},
                        conflicts={},
                        unresolved=CORE_FIELDS,
                        status="structural_drift",
                        structural_drift=True,
                        fingerprint_similarity=similarity,
                    )
                )
                continue
            observations = self._observations(page.url, sanitized_html)
            observations.extend(
                redact_candidate(item)
                for item in profile_observer.observe(page.url, sanitized_html)
            )
            observations.extend(
                redact_candidate(item)
                for item in self._location_observer.observe_candidates(observations, sanitized_html)
            )
            resolution = resolve_candidates(observations)
            output.append(
                ExtractedListing(
                    canonical_url=normalize_url(page.url),
                    normalized=_redact_mapping(resolution.values),
                    source_claims={
                        name: tuple(_redact_value(value) for value in values)
                        for name, values in resolution.source_claims.items()
                    },
                    evidence=self._evidence(
                        observations, resolution.accepted, resolution.conflicts
                    ),
                    conflicts={
                        name: tuple(values) for name, values in resolution.conflicts.items()
                    },
                    unresolved=tuple(resolution.unresolved),
                    status=resolution.status,
                    structural_drift=False,
                    fingerprint_similarity=similarity,
                )
            )
        return tuple(output)

    def run(
        self,
        seed_url: str,
        *,
        training_page_count: int = 5,
        validation_page_count: int = 5,
    ) -> ExtractionOutcome:
        discovery = self.discover(seed_url)
        profile = self.propose_profile(
            discovery,
            training_page_count=training_page_count,
            validation_page_count=validation_page_count,
        )
        detail_pages = [
            ExtractionPage(page.url, page.sanitized_html)
            for page in discovery.pages
            if page.classification.kind is PageKind.RENTAL_LISTING
            and page.sanitized_html is not None
        ]
        return ExtractionOutcome(discovery, profile, self.apply_profile(profile, detail_pages))

    def _fetch(self, url: str) -> tuple[FetchRecord, str]:
        batch = self._fetcher.fetch([url])
        if not batch.records:
            raise ExtractionContractError("The fetcher returned no record")
        record = batch.records[0]
        if record.page is not None:
            html = record.page.body.decode("utf-8", errors="replace")
            if looks_like_javascript_shell(html):
                rendered = self._fetcher.fetch([url], render=True)
                if rendered.records:
                    return rendered.records[0], "browser"
        return record, "http"

    def _group_structures(
        self, pages: Sequence[DiscoveryPage]
    ) -> tuple[tuple[StructureGroup, ...], str | None]:
        detail_pages = [
            page
            for page in pages
            if page.classification.kind is PageKind.RENTAL_LISTING
            and page.sanitized_html is not None
        ]
        pending = set(range(len(detail_pages)))
        components: list[list[int]] = []
        fingerprints = [dom_fingerprint(page.sanitized_html or "") for page in detail_pages]
        while pending:
            first = pending.pop()
            component = [first]
            frontier = [first]
            while frontier:
                current = frontier.pop()
                matches = [
                    candidate
                    for candidate in tuple(pending)
                    if fingerprint_similarity(fingerprints[current], fingerprints[candidate])
                    >= STRUCTURE_SIMILARITY
                ]
                for candidate in matches:
                    pending.remove(candidate)
                frontier.extend(matches)
                component.extend(matches)
            components.append(component)

        grouped: list[tuple[str, str, tuple[str, ...], tuple[str, ...], tuple[str, ...]]] = []
        for component in components:
            members = [detail_pages[index] for index in component]
            supported: list[str] = []
            excluded: list[str] = []
            for member in members:
                observations = self._observations(member.url, member.sanitized_html or "")
                eligibility = self._location_observer.eligibility(
                    member.url,
                    member.sanitized_html or "",
                    observations,
                    context_url=member.discovered_from,
                )
                (excluded if eligibility == "out_of_scope" else supported).append(member.url)
            shape = Counter(normalize_url_shape(member.url) for member in members).most_common(1)[
                0
            ][0]
            grouped.append((
                fingerprint_centroid(fingerprints[index] for index in component),
                shape,
                tuple(member.url for member in members),
                tuple(supported),
                tuple(excluded),
            ))
        dominant = max(grouped, key=lambda item: (len(item[3]), len(item[2])), default=None)
        dominant_fingerprint = dominant[0] if dominant and dominant[3] else None
        total = len(detail_pages)
        structures = tuple(
            StructureGroup(
                fingerprint=fingerprint,
                representative_url_shape=shape,
                page_urls=urls,
                supported_page_urls=supported,
                excluded_page_urls=excluded,
                coverage=len(supported) / total if total else 0.0,
                selected=fingerprint == dominant_fingerprint,
            )
            for fingerprint, shape, urls, supported, excluded in sorted(
                grouped, key=lambda item: (-len(item[3]), item[0])
            )
        )
        return structures, dominant_fingerprint

    def _observations(self, url: str, html: str) -> list[FieldCandidate]:
        output = [
            *StructuredDataObserver().observe(url, html),
            *MetadataObserver().observe(url, html),
            *DomLabelObserver().observe(url, html),
            *PersianTextObserver().observe(url, html),
        ]
        return [redact_candidate(item) for item in output]

    def _validate_profile(
        self,
        mapping: Mapping[str, Any],
        training: Sequence[_ProfilePage],
        held_out: Sequence[_ProfilePage],
    ) -> ProfileValidation:
        observer = ApprovedProfileObserver(dict(mapping))
        required_resolved = math.ceil(len(held_out) * PROFILE_VALIDATION_RATIO)
        resolved = {field_name: 0 for field_name in ALL_FIELDS}
        conflicts = {field_name: 0 for field_name in ALL_FIELDS}
        missing_urls: dict[str, list[str]] = {field_name: [] for field_name in ALL_FIELDS}
        conflict_urls: dict[str, list[str]] = {field_name: [] for field_name in ALL_FIELDS}
        page_reports: list[ValidationPage] = []
        for page in held_out:
            observations = self._observations(page.url, page.html)
            observations.extend(
                redact_candidate(item) for item in observer.observe(page.url, page.html)
            )
            observations.extend(
                redact_candidate(item)
                for item in self._location_observer.observe_candidates(observations, page.html)
            )
            resolution = resolve_candidates(observations)
            for field_name in ALL_FIELDS:
                if field_name in resolution.conflicts:
                    conflicts[field_name] += 1
                    conflict_urls[field_name].append(page.url)
                elif field_name in resolution.values and field_name not in resolution.unresolved:
                    resolved[field_name] += 1
                else:
                    missing_urls[field_name].append(page.url)
            page_reports.append(
                ValidationPage(
                    url=page.url,
                    status=resolution.status,
                    unresolved=tuple(resolution.unresolved),
                    conflicts={
                        name: tuple(values) for name, values in resolution.conflicts.items()
                    },
                    evidence=self._evidence(
                        observations, resolution.accepted, resolution.conflicts
                    ),
                )
            )
        fields = {
            field_name: FieldValidation(
                resolved=resolved[field_name],
                conflicts=conflicts[field_name],
                coverage=resolved[field_name] / len(held_out),
                passed=(resolved[field_name] >= required_resolved and conflicts[field_name] == 0),
                missing_page_urls=tuple(missing_urls[field_name]),
                conflict_page_urls=tuple(conflict_urls[field_name]),
            )
            for field_name in ALL_FIELDS
        }
        return ProfileValidation(
            training_page_urls=tuple(page.url for page in training),
            held_out_page_urls=tuple(page.url for page in held_out),
            required_resolved=required_resolved,
            fields=fields,
            pages=tuple(page_reports),
            approval_enabled=all(fields[field_name].passed for field_name in CORE_FIELDS),
        )

    @staticmethod
    def _evidence(
        observations: Sequence[FieldCandidate],
        accepted: Mapping[str, FieldCandidate],
        conflicts: Mapping[str, Sequence[Any]],
    ) -> Mapping[str, tuple[FieldEvidence, ...]]:
        output: dict[str, tuple[FieldEvidence, ...]] = {}
        for field_name in sorted({item.field_name for item in observations}):
            candidates = [item for item in observations if item.field_name == field_name]
            output[field_name] = tuple(
                FieldEvidence(
                    observer_name=item.observer_name,
                    raw_value=_redact_value(item.raw_value),
                    normalized_value=_redact_value(item.normalized_value),
                    confidence=item.confidence,
                    source_locator=redact_phone_numbers(item.source_locator),
                    evidence_snippet=redact_phone_numbers(item.evidence_snippet),
                    disposition=(
                        "conflicting_candidate"
                        if field_name in conflicts
                        else "selected"
                        if accepted.get(field_name) == item
                        else "alternative_evidence"
                    ),
                )
                for item in candidates[:12]
            )
        return output


def _redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return redact_phone_numbers(value)
    if isinstance(value, list | tuple):
        return type(value)(_redact_value(item) for item in value)
    if isinstance(value, dict):
        return {name: _redact_value(item) for name, item in value.items()}
    return value


def _redact_mapping(value: Mapping[str, Any]) -> Mapping[str, Any]:
    return {name: _redact_value(item) for name, item in value.items()}


def serialize_contract_result(value: Any) -> Any:
    """Return JSON-compatible output for persistence adapters without owning persistence."""
    if hasattr(value, "__dataclass_fields__"):
        return asdict(value)
    raise TypeError("Expected an extraction contract result")
