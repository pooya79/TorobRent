from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

import pytest

from apps.source_extraction.contract import (
    ExtractionContract,
    ExtractionPage,
    PageKind,
    SourceProfile,
    serialize_contract_result,
)
from apps.source_extraction.discovery import classify_page
from apps.source_extraction.fetching import FetchBatch, FetchedPage, FetchRecord

FIXTURE_ROOT = Path(__file__).parent / "fixtures/source_extraction"


def listing_html(*, area: int = 85, phone: str = "09121234567") -> str:
    return (
        (FIXTURE_ROOT / "torobtest_listing.html")
        .read_text(encoding="utf-8")
        .replace("{{ floor_area }}", str(area))
        .replace("{{ phone }}", phone)
    )


class FixtureFetcher:
    def __init__(self, pages: dict[str, str]) -> None:
        self.pages = pages
        self.calls: list[tuple[tuple[str, ...], bool]] = []

    def fetch(self, urls: Sequence[str], *, render: bool = False) -> FetchBatch:
        self.calls.append((tuple(urls), render))
        return FetchBatch(
            tuple(
                FetchRecord(
                    requested_url=url,
                    page=FetchedPage(
                        url=url,
                        status_code=200,
                        body=self.pages[url].encode(),
                        headers={"content-type": "text/html; charset=utf-8"},
                    ),
                )
                for url in urls
            )
        )


class BrowserFallbackFetcher(FixtureFetcher):
    def __init__(self, pages: dict[str, str], rendered_pages: dict[str, str]) -> None:
        super().__init__(pages)
        self.rendered_pages = rendered_pages

    def fetch(self, urls: Sequence[str], *, render: bool = False) -> FetchBatch:
        active_pages = self.rendered_pages if render else self.pages
        self.calls.append((tuple(urls), render))
        return FetchBatch(
            tuple(
                FetchRecord(
                    requested_url=url,
                    page=FetchedPage(
                        url=url,
                        status_code=200,
                        body=active_pages.get(url, self.pages[url]).encode(),
                        headers={"content-type": "text/html"},
                    ),
                )
                for url in urls
            )
        )


def build_profile() -> tuple[ExtractionContract, SourceProfile]:
    seed_url = "https://source.example/rent"
    detail_urls = [f"https://source.example/listing/{number}" for number in range(20000, 20004)]
    links = "".join(f'<a href="{url}">اجاره آپارتمان تهران</a>' for url in detail_urls)
    contract = ExtractionContract(
        FixtureFetcher({
            seed_url: f"<h1>رهن و اجاره خانه</h1>{links}",
            **{url: listing_html(area=90 + index) for index, url in enumerate(detail_urls)},
        }),
        max_pages=5,
    )
    discovery = contract.discover(seed_url)
    return contract, contract.propose_profile(
        discovery, training_page_count=2, validation_page_count=2
    )


def test_contract_discovers_and_scores_same_host_rental_pages() -> None:
    seed_url = "https://source.example/rent"
    detail_urls = [f"https://source.example/listing/{number}" for number in range(12345, 12348)]
    fetcher = FixtureFetcher({
        seed_url: """
                <h1>رهن و اجاره خانه</h1>
                <a href="/listing/12345">اجاره آپارتمان در تهران</a>
                <a href="/listing/12346">اجاره خانه در تهران</a>
                <a href="/listing/12347">رهن ویلا در تهران</a>
                <a href="https://other.example/listing/99999">اجاره خانه</a>
            """,
        **{url: listing_html(area=85 + index) for index, url in enumerate(detail_urls)},
    })

    discovery = ExtractionContract(fetcher, max_pages=5).discover(seed_url)

    assert [page.url for page in discovery.pages] == [seed_url, *detail_urls]
    assert discovery.pages[0].classification.kind is PageKind.RENTAL_INDEX
    assert all(page.classification.kind is PageKind.RENTAL_LISTING for page in discovery.pages[1:])
    assert all(page.discovered_from == seed_url for page in discovery.pages[1:])
    assert all(page.link_score > 0 for page in discovery.pages[1:])
    assert "other.example" not in " ".join(page.url for page in discovery.pages)


def test_dense_rental_index_is_not_misclassified_from_aggregate_card_details() -> None:
    seed_url = "https://source.example/rent"
    detail_urls = [f"https://source.example/listing/{number}" for number in range(20000, 20024)]
    links = "".join(
        f'<a href="{url}">اجاره آپارتمان {index}</a>' for index, url in enumerate(detail_urls)
    )
    seed_html = (
        f"<h1>اجاره خانه و آپارتمان</h1><p>ودیعه، اجاره ماهانه، متراژ، تعداد اتاق و تماس</p>{links}"
    )
    fetcher = FixtureFetcher({
        seed_url: seed_html,
        **{url: listing_html() for url in detail_urls},
    })

    discovery = ExtractionContract(
        fetcher,
        max_pages=3,
        target_detail_pages=2,
    ).discover(seed_url)

    assert discovery.pages[0].classification.kind is PageKind.RENTAL_INDEX
    assert [page.url for page in discovery.pages[1:]] == detail_urls[:2]
    assert discovery.detail_page_count == 2


def test_listing_ids_before_file_extensions_rank_details_ahead_of_facets() -> None:
    seed_url = "https://source.example/s/tehran/house-apartment-for-rent"
    facet_urls = [
        "https://source.example/s/tehran/a/house-apartment-for-rent",
        "https://source.example/s/tehran/b/house-apartment-for-rent",
    ]
    detail_urls = [
        "https://source.example/v/listing-12345.html",
        "https://source.example/v/listing-12346.html",
    ]
    seed_html = (
        "<h1>Rental properties in Tehran</h1>"
        + "".join(f'<a href="{url}">Apartment for rent in Tehran</a>' for url in facet_urls)
        + "".join(f'<a href="{url}">Rent in Tehran</a>' for url in detail_urls)
    )
    fetcher = FixtureFetcher({
        seed_url: seed_html,
        **{url: "<h1>Rental properties in Tehran</h1>" for url in facet_urls},
        **{url: listing_html() for url in detail_urls},
    })

    discovery = ExtractionContract(
        fetcher,
        max_pages=3,
        target_detail_pages=2,
    ).discover(seed_url)

    assert [page.url for page in discovery.pages] == [seed_url, *detail_urls]
    assert discovery.detail_page_count == 2


def test_detail_url_identity_outweighs_dense_recommendation_links() -> None:
    recommendations = "".join(
        f'<a href="/v/recommended-{number}.html">اجاره آپارتمان</a>'
        for number in range(20000, 20030)
    )
    detail_html = (
        "<h1>اجاره آپارتمان در تهران</h1>"
        "<p>ودیعه، اجاره ماهانه، متراژ، تعداد اتاق و تماس</p>"
        f"{recommendations}"
    )

    detail = classify_page(
        "https://source.example/v/apartment-for-rent-467115111.html",
        detail_html,
    )
    category = classify_page(
        "https://source.example/s/tehran/house-apartment-for-rent",
        detail_html,
    )

    assert detail.kind is PageKind.RENTAL_LISTING
    assert category.kind is PageKind.RENTAL_INDEX


def test_structured_sale_link_is_not_forced_into_rental_classification() -> None:
    seed_url = "https://source.example/rent"
    sale_url = "https://source.example/sale/12345"
    rental_urls = ["https://source.example/listing/12346", "https://source.example/listing/12347"]
    structured_items = [
        {"@type": "Product", "name": "فروش آپارتمان", "url": sale_url},
        *[{"@type": "Apartment", "name": "اجاره آپارتمان", "url": url} for url in rental_urls],
    ]
    seed_html = (
        "<h1>رهن و اجاره خانه</h1><script type='application/ld+json'>"
        + json.dumps(structured_items, ensure_ascii=False)
        + "</script>"
    )
    fetcher = FixtureFetcher({
        seed_url: seed_html,
        sale_url: "<h1>فروش آپارتمان</h1><p>متراژ ۸۵ و قیمت فروش</p>",
        **{url: listing_html() for url in rental_urls},
    })

    discovery = ExtractionContract(fetcher, max_pages=4).discover(seed_url)

    sale_page = next(page for page in discovery.pages if page.url == sale_url)
    assert sale_page.classification.kind is PageKind.OTHER_PROPERTY


def test_contract_builds_validated_profile_and_extracts_normalized_listings() -> None:
    seed_url = "https://source.example/rent"
    detail_urls = [f"https://source.example/listing/{number}" for number in range(10000, 10004)]
    links = "".join(f'<a href="{url}">اجاره آپارتمان در تهران</a>' for url in detail_urls)
    phones = ("0912 000 0000", "+98-912-000-0001", "021-1234-5678", "۰۹۱۲ ۰۰۰ ۰۰۰۳")
    fetcher = FixtureFetcher({
        seed_url: f"<h1>رهن و اجاره خانه</h1>{links}",
        **{
            url: listing_html(area=80 + index, phone=phones[index])
            for index, url in enumerate(detail_urls)
        },
    })

    outcome = ExtractionContract(fetcher, max_pages=5).run(
        seed_url, training_page_count=2, validation_page_count=2
    )

    assert outcome.profile.validation.approval_enabled is True
    assert set(outcome.profile.mapping) >= {
        "floor_area_sqm",
        "bedroom_count",
        "deposit_rial",
        "monthly_rent_rial",
    }
    assert len(outcome.listings) == 4
    assert all(listing.status == "accepted" for listing in outcome.listings)
    assert outcome.listings[0].normalized["deposit_rial"] == 5_000_000_000
    assert outcome.listings[0].normalized["monthly_rent_rial"] == 200_000_000
    retained = json.dumps(serialize_contract_result(outcome), ensure_ascii=False)
    assert all(phone not in retained for phone in phones)
    assert "[redacted-phone]" in retained
    assert all(
        "[redacted-phone]" in (page.sanitized_html or "")
        for page in outcome.discovery.pages
        if page.classification.kind is PageKind.RENTAL_LISTING
    )
    observer_names = {
        item.observer_name
        for field_evidence in outcome.listings[0].evidence.values()
        for item in field_evidence
    }
    assert observer_names >= {
        "structured_data",
        "metadata",
        "dom_labels",
        "persian_text",
        "location_catalog",
    }


def test_discovery_selects_dominant_structure_and_keeps_excluded_coverage_explicit() -> None:
    seed_url = "https://source.example/rent"
    detail_urls = [f"https://source.example/listing/{number}" for number in range(30000, 30004)]
    links = "".join(f'<a href="{url}">اجاره آپارتمان تهران</a>' for url in detail_urls)
    alternate = (
        """
        <html><body><main class="redesign"><h1>اجاره خانه در تهران</h1>
        <p>ودیعه ۵۰۰ میلیون تومان، اجاره ماهانه ۲۰ میلیون تومان</p>
        <p>متراژ ۸۵، اتاق خواب ۲</p><button>تماس</button>
        """
        + "".join(
            f'<article class="tile-{index}"><section><b>جزئیات</b></section></article>'
            for index in range(40)
        )
        + "</main></body></html>"
    )
    pages = {url: listing_html(area=80 + index) for index, url in enumerate(detail_urls)}
    pages[detail_urls[-1]] = alternate

    discovery = ExtractionContract(
        FixtureFetcher({seed_url: f"<h1>رهن و اجاره خانه</h1>{links}", **pages}),
        max_pages=5,
    ).discover(seed_url)

    assert len(discovery.structures) == 2
    selected = next(group for group in discovery.structures if group.selected)
    assert selected.coverage == 0.75
    assert discovery.excluded_detail_page_urls == (detail_urls[-1],)


def test_conflicting_attributable_values_remain_a_listing_exception() -> None:
    contract, profile = build_profile()
    conflict_html = listing_html(area=90).replace(
        '"floorSize":{"value":"90"}', '"floorSize":{"value":"80"}'
    )

    listing = contract.apply_profile(
        profile, [ExtractionPage("https://source.example/listing/99999", conflict_html)]
    )[0]

    assert listing.status == "needs_review"
    assert listing.conflicts["floor_area_sqm"] == (80, 90)
    assert {item.observer_name for item in listing.evidence["floor_area_sqm"]} >= {
        "structured_data",
        "dom_labels",
    }


@pytest.mark.parametrize(
    ("count", "training_count", "held_out_count"), [(1, 1, 0), (3, 2, 1), (10, 5, 5)]
)
def test_profile_creation_uses_actual_disjoint_samples(count, training_count, held_out_count):
    seed_url = "https://source.example/rent"
    urls = [f"https://source.example/listing/{40000 + i}" for i in range(count)]
    pages = {url: listing_html(area=85 + i) for i, url in enumerate(urls)}
    contract = ExtractionContract(
        FixtureFetcher({
            seed_url: "<h1>رهن و اجاره خانه</h1>"
            + "".join(f'<a href="{url}">اجاره آپارتمان تهران</a>' for url in urls),
            **pages,
        }),
        max_pages=count + 1,
    )
    profile = contract.propose_profile(contract.discover(seed_url))
    validation = profile.validation
    assert len(validation.training_page_urls) == training_count
    assert len(validation.held_out_page_urls) == held_out_count
    assert set(validation.training_page_urls).isdisjoint(validation.held_out_page_urls)
    assert set(validation.training_page_urls + validation.held_out_page_urls) == set(urls)
    assert validation.rules_valid and validation.approval_enabled
    if count == 1:
        assert validation.quality_passed is False
        assert validation.pages == ()
        assert all(
            field.coverage is None and field.passed is None for field in validation.fields.values()
        )
    updated = contract.revalidate_profile(
        profile, [ExtractionPage(url, html) for url, html in pages.items()], profile.mapping
    )
    assert updated.validation == validation


def test_profile_application_returns_structural_drift_without_guessing_fields() -> None:
    contract, profile = build_profile()
    redesigned = (FIXTURE_ROOT / "torobtest_redesigned.html").read_text(encoding="utf-8")

    listing = contract.apply_profile(
        profile, [ExtractionPage("https://source.example/listing/99998", redesigned)]
    )[0]

    assert listing.status == "structural_drift"
    assert listing.structural_drift is True
    assert listing.normalized == {}
    assert listing.unresolved == (
        "city",
        "district",
        "neighborhood",
        "property_type",
        "floor_area_sqm",
        "bedroom_count",
        "deposit_rial",
        "monthly_rent_rial",
    )


def test_discovery_uses_guarded_browser_fallback_for_a_javascript_shell() -> None:
    seed_url = "https://source.example/rent"
    detail_urls = [f"https://source.example/listing/{number}" for number in range(50000, 50003)]
    links = "".join(f'<a href="{url}">اجاره آپارتمان تهران</a>' for url in detail_urls)
    bootstrap_shell = """
        <html>
          <head>
            <title>Rental listings</title>
            <script type="application/ld+json">
              {"@context":"https://schema.org","@type":"WebSite","name":"Example"}
            </script>
            <script>window.env = {"FORCE_SSR_FOR_KNOWN_BOTS": true};</script>
            <script src="/static/app.js"></script>
          </head>
          <body></body>
        </html>
    """
    fetcher = BrowserFallbackFetcher(
        {
            seed_url: bootstrap_shell,
            **{url: listing_html() for url in detail_urls},
        },
        {seed_url: f"<h1>رهن و اجاره خانه</h1>{links}"},
    )

    discovery = ExtractionContract(fetcher, max_pages=4).discover(seed_url)

    assert discovery.pages[0].rendering_method == "browser"
    assert ((seed_url,), True) in fetcher.calls
    assert discovery.detail_page_count == 3


def test_discovery_rejects_a_browser_fallback_that_remains_a_javascript_shell() -> None:
    seed_url = "https://source.example/rent"
    bootstrap_shell = """
        <html>
          <head>
            <title>Rental listings</title>
            <script>window.bootstrap = {};</script>
          </head>
          <body></body>
        </html>
    """
    fetcher = BrowserFallbackFetcher(
        {seed_url: bootstrap_shell},
        {seed_url: bootstrap_shell},
    )

    discovery = ExtractionContract(fetcher, max_pages=1).discover(seed_url)

    page = discovery.pages[0]
    assert page.classification.kind is PageKind.FETCH_ERROR
    assert page.sanitized_html is None


def test_discovery_preserves_an_empty_body_with_usable_listing_json_ld() -> None:
    seed_url = "https://source.example/rent"
    structured_listings = ",".join(
        f'{{"@type":"Apartment","url":"{seed_url}/{number}"}}' for number in range(10000, 10003)
    )
    structured_index = f"""
        <html>
          <head>
            <title>Rental listings</title>
            <script type="application/ld+json">[{structured_listings}]</script>
          </head>
          <body></body>
        </html>
    """
    fetcher = BrowserFallbackFetcher(
        {seed_url: structured_index},
        {seed_url: structured_index},
    )

    discovery = ExtractionContract(fetcher, max_pages=1).discover(seed_url)

    page = discovery.pages[0]
    assert page.classification.kind is PageKind.RENTAL_INDEX
    assert page.sanitized_html is not None


def test_discovery_retries_guarded_http_after_transient_shell_responses() -> None:
    seed_url = "https://source.example/rent"
    bootstrap_shell = """
        <html><head><title>Rental listings</title><script src="/app.js"></script></head>
        <body></body></html>
    """
    rich_page = """
        <html><body>
          <h1>Rental listings</h1>
          <a href="/listing/12345">Apartment for rent in Tehran</a>
        </body></html>
    """

    class TransientShellFetcher:
        def __init__(self) -> None:
            self.calls: list[tuple[tuple[str, ...], bool]] = []
            self.http_attempts = 0

        def fetch(self, urls: Sequence[str], *, render: bool = False) -> FetchBatch:
            self.calls.append((tuple(urls), render))
            if render:
                body = bootstrap_shell
            else:
                self.http_attempts += 1
                body = bootstrap_shell if self.http_attempts == 1 else rich_page
            return FetchBatch((
                FetchRecord(
                    requested_url=urls[0],
                    page=FetchedPage(
                        url=urls[0],
                        status_code=200,
                        body=body.encode(),
                        headers={"content-type": "text/html"},
                    ),
                ),
            ))

    fetcher = TransientShellFetcher()

    discovery = ExtractionContract(fetcher, max_pages=1).discover(seed_url)

    page = discovery.pages[0]
    assert page.rendering_method == "http"
    assert page.sanitized_html is not None
    assert "Apartment for rent in Tehran" in page.sanitized_html


@pytest.mark.parametrize(
    "rule",
    [
        {"kind": "script", "code": "return document.body"},
        {"kind": "css", "selector": "div:has(*)", "transform": "integer"},
        {"kind": "css", "selector": "div,script", "transform": "integer"},
        {"kind": "css", "selector": ".area", "transform": "eval"},
        {"kind": "css", "selector": ".area", "transform": "integer", "code": "exec()"},
        {"kind": "json", "path": "$..floorSize", "transform": "integer"},
        {
            "kind": "json",
            "path": "$.floorSize",
            "script_selector": "script",
            "transform": "integer",
        },
        {"kind": "css", "selector": "a " * 100, "transform": "integer"},
        {"variants": [{"kind": "css", "selector": ".area", "transform": "integer"}] * 17},
        {"kind": "css", "selector": ".area", "transform": ["integer"]},
    ],
)
def test_revalidation_rejects_unbounded_or_executable_rules(rule) -> None:
    _, profile = build_profile()
    with pytest.raises(ValueError):
        ExtractionContract().revalidate_profile(profile, [], {"floor_area_sqm": rule})


def test_revalidation_keeps_held_out_split_and_optional_claims_do_not_block() -> None:
    _, profile = build_profile()
    pages = [
        ExtractionPage(f"https://source.example/listing/{20000 + i}", listing_html(area=90 + i))
        for i in range(4)
    ]
    updated = ExtractionContract().revalidate_profile(
        profile,
        pages,
        {
            **profile.mapping,
            "construction_year": {"kind": "css", "selector": ".missing", "transform": "integer"},
        },
    )
    assert updated.validation.training_page_urls == profile.validation.training_page_urls
    assert updated.validation.held_out_page_urls == profile.validation.held_out_page_urls
    assert updated.validation.fields["construction_year"].passed is False
    assert updated.validation.approval_enabled is True


def test_commercial_extraction_does_not_require_bedrooms():
    pages = {
        f"https://example.com/listing/{number}": listing_html(area=85 + number)
        for number in range(10)
    }
    seed = "https://example.com/rentals"
    pages[seed] = "<h1>رهن و اجاره</h1>" + "".join(
        f'<a href="{url}">اجاره آپارتمان تهران</a>' for url in pages
    )
    contract = ExtractionContract(FixtureFetcher(pages))
    profile = contract.propose_profile(contract.discover(seed))
    office = (
        listing_html()
        .replace("Apartment", "Office")
        .replace("آپارتمان", "دفتر اداری")
        .replace(',"numberOfRooms":2', "")
        .replace('<dt>اتاق خواب</dt><dd class="rooms">2</dd>', "")
    )
    result = contract.apply_profile(
        profile, [ExtractionPage("https://example.com/listing/office", office)]
    )[0]
    assert result.normalized["property_type"] == "office"
    assert "bedroom_count" not in result.unresolved
    assert result.status == "accepted"
