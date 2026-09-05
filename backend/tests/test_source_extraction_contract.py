from __future__ import annotations

import json
from collections.abc import Sequence

import pytest

from apps.source_extraction.contract import (
    ExtractionContract,
    ExtractionContractError,
    ExtractionPage,
    PageKind,
    SourceProfile,
    serialize_contract_result,
)
from apps.source_extraction.fetching import FetchBatch, FetchedPage, FetchRecord


def listing_html(*, area: int = 85, phone: str = "09121234567") -> str:
    return f"""
    <html><head>
      <script type="application/ld+json">
        {{"@type":"Apartment","name":"اجاره آپارتمان در سعادت‌آباد",
        "floorSize":{{"value":"{area}"}},"numberOfRooms":2,
        "address":{{"addressLocality":"سعادت‌آباد","addressRegion":"تهران"}}}}
      </script>
    </head><body>
      <h1>اجاره آپارتمان در سعادت‌آباد</h1>
      <dl>
        <dt>متراژ</dt><dd class="area">{area} متر</dd>
        <dt>اتاق خواب</dt><dd class="rooms">2</dd>
        <dt>ودیعه (تومان)</dt><dd class="deposit">۵۰۰ میلیون تومان</dd>
        <dt>اجاره ماهانه (تومان)</dt><dd class="rent">۲۰ میلیون تومان</dd>
      </dl>
      <p>موقعیت در تهران، سعادت‌آباد</p><p>تماس: {phone}</p>
    </body></html>
    """


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


def test_contract_builds_validated_profile_and_extracts_normalized_listings() -> None:
    seed_url = "https://source.example/rent"
    detail_urls = [f"https://source.example/listing/{number}" for number in range(10000, 10004)]
    links = "".join(f'<a href="{url}">اجاره آپارتمان در تهران</a>' for url in detail_urls)
    fetcher = FixtureFetcher({
        seed_url: f"<h1>رهن و اجاره خانه</h1>{links}",
        **{
            url: listing_html(area=80 + index, phone=f"0912000000{index}")
            for index, url in enumerate(detail_urls)
        },
    })

    outcome = ExtractionContract(fetcher, max_pages=5).run(
        seed_url, training_page_count=2, validation_page_count=2
    )

    assert outcome.profile.validation.approval_enabled is True
    assert set(outcome.profile.mapping) >= {
        "area_sqm",
        "room_count",
        "deposit_rial",
        "monthly_rent_rial",
    }
    assert len(outcome.listings) == 4
    assert all(listing.status == "accepted" for listing in outcome.listings)
    assert outcome.listings[0].normalized["deposit_rial"] == 5_000_000_000
    assert outcome.listings[0].normalized["monthly_rent_rial"] == 200_000_000
    retained = json.dumps(serialize_contract_result(outcome), ensure_ascii=False)
    assert "091200000" not in retained
    assert "[redacted-phone]" in retained


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
    assert listing.conflicts["area_sqm"] == (80, 90)
    assert {item.observer_name for item in listing.evidence["area_sqm"]} >= {
        "structured_data",
        "dom_labels",
    }


def test_profile_creation_reports_low_dominant_structure_coverage() -> None:
    seed_url = "https://source.example/rent"
    detail_urls = [f"https://source.example/listing/{number}" for number in range(40000, 40003)]
    links = "".join(f'<a href="{url}">اجاره آپارتمان تهران</a>' for url in detail_urls)
    contract = ExtractionContract(
        FixtureFetcher({
            seed_url: f"<h1>رهن و اجاره خانه</h1>{links}",
            **{url: listing_html() for url in detail_urls},
        }),
        max_pages=4,
    )

    discovery = contract.discover(seed_url)

    with pytest.raises(ExtractionContractError, match="needs 4 pages.*found 3"):
        contract.propose_profile(discovery, training_page_count=2, validation_page_count=2)


def test_profile_application_returns_structural_drift_without_guessing_fields() -> None:
    contract, profile = build_profile()
    redesigned = (
        "<html><body><main>"
        + '<article class="redesigned-card"><span>new layout</span></article>' * 80
        + "</main></body></html>"
    )

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
        "area_sqm",
        "room_count",
        "deposit_rial",
        "monthly_rent_rial",
    )


def test_discovery_uses_guarded_browser_fallback_for_a_javascript_shell() -> None:
    seed_url = "https://source.example/rent"
    detail_urls = [f"https://source.example/listing/{number}" for number in range(50000, 50003)]
    links = "".join(f'<a href="{url}">اجاره آپارتمان تهران</a>' for url in detail_urls)
    fetcher = BrowserFallbackFetcher(
        {
            seed_url: (
                '<html><body><div id="root"></div><script src="app.js"></script></body></html>'
            ),
            **{url: listing_html() for url in detail_urls},
        },
        {seed_url: f"<h1>رهن و اجاره خانه</h1>{links}"},
    )

    discovery = ExtractionContract(fetcher, max_pages=4).discover(seed_url)

    assert discovery.pages[0].rendering_method == "browser"
    assert ((seed_url,), True) in fetcher.calls
    assert discovery.detail_page_count == 3
