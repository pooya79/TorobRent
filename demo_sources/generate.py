"""Generate large, deterministic fictional property websites for live demonstrations."""

from __future__ import annotations

import argparse
import html
import json
import math
import random
import shutil
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT / "generated"
PAGE_SIZE = 20


@dataclass(frozen=True)
class Site:
    key: str
    name: str
    count: int
    first_id: int
    presentation: str
    accent: str
    accent_dark: str


@dataclass(frozen=True)
class Listing:
    identifier: int
    neighborhood: str
    district: int
    property_type: str
    schema_type: str
    area: int
    bedrooms: int
    floor: int
    construction_year: int
    deposit_toman: int
    rent_toman: int
    published_at: str
    image: str
    latitude: str
    longitude: str

    @property
    def title(self) -> str:
        return f"اجاره {self.property_type} {self.area} متری در {self.neighborhood}"


SITES = (
    Site("jsonld", "خانه روشن", 300, 10000, "jsonld", "#e85d36", "#9f3216"),
    Site("legacy", "ملک تهران", 250, 20000, "legacy", "#147d72", "#07534c"),
    Site("javascript", "آشیانه", 150, 30000, "javascript", "#6657c8", "#40339b"),
    Site("mixed", "چهارسو ملک", 300, 40000, "mixed", "#b27a16", "#76500c"),
)

NEIGHBORHOODS = (
    ("سعادت‌آباد", 2, "35.7812", "51.3747"),
    ("پونک", 2, "35.7618", "51.3371"),
    ("گلاب دره", 1, "35.8156", "51.4381"),
    ("محمودیه", 1, "35.7946", "51.4059"),
    ("نیاوران", 1, "35.8120", "51.4698"),
    ("ولنجک", 1, "35.8044", "51.3965"),
    ("توحید", 2, "35.7142", "51.3816"),
    ("کاووسیه", 3, "35.7561", "51.4148"),
    ("ونک", 3, "35.7575", "51.4095"),
    ("شهرک غرب", 2, "35.7588", "51.3744"),
)

PROPERTY_TYPES = (
    ("آپارتمان", "Apartment"),
    ("آپارتمان", "Apartment"),
    ("آپارتمان", "Apartment"),
    ("خانه", "House"),
    ("ویلا", "SingleFamilyResidence"),
)

IMAGES = ("apartment-bright.webp", "apartment-blue.webp", "office-modern.webp")


def toman(value: int) -> str:
    return f"{value:,} تومان"


def make_listings(site: Site) -> list[Listing]:
    randomizer = random.Random(20260908 + site.first_id)
    listings: list[Listing] = []
    for offset in range(site.count):
        neighborhood, district, latitude, longitude = NEIGHBORHOODS[
            offset % len(NEIGHBORHOODS)
        ]
        property_type, schema_type = PROPERTY_TYPES[offset % len(PROPERTY_TYPES)]
        bedrooms = randomizer.choice((1, 2, 2, 3, 3, 4))
        area = randomizer.randrange(max(45, bedrooms * 28), min(220, bedrooms * 55) + 1)
        listing = Listing(
            identifier=site.first_id + offset,
            neighborhood=neighborhood,
            district=district,
            property_type=property_type,
            schema_type=schema_type,
            area=area,
            bedrooms=bedrooms,
            floor=randomizer.randrange(1, 12),
            construction_year=randomizer.randrange(1388, 1405),
            deposit_toman=randomizer.randrange(200, 2200, 50) * 1_000_000,
            rent_toman=randomizer.randrange(8, 90) * 1_000_000,
            published_at=str(date(2026, 8, 1) + timedelta(days=offset % 30)),
            image=IMAGES[offset % len(IMAGES)],
            latitude=latitude,
            longitude=longitude,
        )
        listings.append(listing)
    return listings


def shell(site: Site, *, title: str, body: str, description: str) -> str:
    return f"""<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="description" content="{html.escape(description)}">
  <title>{html.escape(title)} | {html.escape(site.name)}</title>
  <link rel="stylesheet" href="/assets/site.css">
  <style>:root {{--accent:{site.accent};--accent-dark:{site.accent_dark}}}</style>
</head>
<body>
  <div class="demo-strip">وب‌سایت نمایشی — تمام آگهی‌ها و اطلاعات ساختگی هستند</div>
  <header class="site-header">
    <a class="brand" href="/">{html.escape(site.name)}</a>
    <nav aria-label="ناوبری اصلی">
      <a href="/rentals/">رهن و اجاره</a>
      <a href="/about/">درباره ما</a>
      <a href="/contact/">تماس</a>
    </nav>
  </header>
  <main>{body}</main>
  <footer>
    <strong>{html.escape(site.name)}</strong>
    <span>مرجع نمایشی آگهی‌های اجاره در تهران</span>
    <span>داده واقعی یا اطلاعات تماس معتبر در این وب‌سایت وجود ندارد.</span>
  </footer>
</body>
</html>
"""


def listing_json_ld(host: str, listing: Listing) -> str:
    payload = {
        "@context": "https://schema.org",
        "@type": listing.schema_type,
        "@id": f"https://{host}/property/{listing.identifier}/",
        "url": f"https://{host}/property/{listing.identifier}/",
        "name": listing.title,
        "description": f"ملک اجاره‌ای در تهران، منطقه {listing.district}، {listing.neighborhood}",
        "datePosted": listing.published_at,
        "floorSize": {
            "@type": "QuantitativeValue",
            "value": listing.area,
            "unitCode": "MTK",
        },
        "numberOfBedrooms": listing.bedrooms,
        "numberOfRooms": listing.bedrooms,
        "address": {
            "@type": "PostalAddress",
            "addressLocality": listing.neighborhood,
            "addressRegion": "تهران",
            "streetAddress": f"منطقه {listing.district}",
        },
        "geo": {
            "@type": "GeoCoordinates",
            "latitude": listing.latitude,
            "longitude": listing.longitude,
        },
        "image": [f"https://{host}/images/{listing.image}"],
        "offers": {
            "@type": "Offer",
            "price": listing.rent_toman,
            "priceCurrency": "IRT",
        },
        "priceSpecification": [
            {
                "@type": "UnitPriceSpecification",
                "name": "ودیعه",
                "priceType": "Security deposit",
                "price": listing.deposit_toman,
                "priceCurrency": "IRT",
            },
            {
                "@type": "UnitPriceSpecification",
                "name": "اجاره ماهانه",
                "priceType": "Monthly rent",
                "price": listing.rent_toman,
                "priceCurrency": "IRT",
            },
        ],
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def facts_dl(listing: Listing, *, variant: str = "standard") -> str:
    if variant == "alternate":
        return f"""
<section class="redesigned-facts">
  <h2>مشخصات این واحد</h2>
  <p><b>مساحت بنا</b><span>{listing.area} متر مربع</span></p>
  <p><b>تعداد اتاق</b><span>{listing.bedrooms}</span></p>
  <p><b>مبلغ رهن</b><span>{toman(listing.deposit_toman)}</span></p>
  <p><b>کرایه ماهانه</b><span>{toman(listing.rent_toman)}</span></p>
  <p><b>سال ساخت</b><span>{listing.construction_year}</span></p>
</section>"""
    return f"""
<dl class="property-facts">
  <div><dt>متراژ</dt><dd class="area">{listing.area} متر</dd></div>
  <div><dt>اتاق خواب</dt><dd class="rooms">{listing.bedrooms}</dd></div>
  <div><dt>ودیعه (تومان)</dt><dd class="deposit">{toman(listing.deposit_toman)}</dd></div>
  <div><dt>اجاره ماهانه (تومان)</dt><dd class="rent">{toman(listing.rent_toman)}</dd></div>
  <div><dt>طبقه</dt><dd class="floor">{listing.floor}</dd></div>
  <div><dt>سال ساخت</dt><dd class="year">{listing.construction_year}</dd></div>
</dl>"""


def facts_table(listing: Listing) -> str:
    return f"""
<table class="legacy-table">
  <caption>مشخصات ملک</caption>
  <tbody>
    <tr><th>متراژ</th><td class="area">{listing.area} متر</td></tr>
    <tr><th>اتاق خواب</th><td class="rooms">{listing.bedrooms}</td></tr>
    <tr><th>ودیعه</th><td class="deposit">{toman(listing.deposit_toman)}</td></tr>
    <tr><th>اجاره ماهانه</th><td class="rent">{toman(listing.rent_toman)}</td></tr>
    <tr><th>طبقه</th><td>{listing.floor}</td></tr>
    <tr><th>سال ساخت</th><td>{listing.construction_year}</td></tr>
  </tbody>
</table>"""


def visible_listing(
    host: str, site: Site, listing: Listing, *, alternate: bool = False
) -> str:
    facts = (
        facts_table(listing)
        if site.presentation == "legacy"
        else facts_dl(listing, variant="alternate" if alternate else "standard")
    )
    return f"""
<nav class="breadcrumbs" aria-label="breadcrumb">
  <a href="/rentals/">اجاره</a><span>/</span>
  <a href="/rentals/?district={listing.district}">{listing.property_type} تهران</a><span>/</span>
  <span>{html.escape(listing.neighborhood)}</span>
</nav>
<article class="property-detail{" alternate" if alternate else ""}">
  <div class="property-heading">
    <div>
      <p class="eyebrow">کد آگهی {listing.identifier}</p>
      <h1>{html.escape(listing.title)}</h1>
      <p class="location">موقعیت در تهران، منطقه {listing.district}، {listing.neighborhood}</p>
    </div>
    <div class="price-box">
      <span>ودیعه {toman(listing.deposit_toman)}</span>
      <strong>اجاره ماهانه {toman(listing.rent_toman)}</strong>
    </div>
  </div>
  <img class="hero-image" src="/images/{listing.image}" alt="تصویر نمایشی {html.escape(listing.title)}">
  <div class="detail-grid">
    <section>
      <h2>اطلاعات آگهی</h2>
      {facts}
    </section>
    <aside class="contact-card">
      <h2>تماس با آگهی‌دهنده</h2>
      <p>این شماره ساختگی و فقط برای بررسی حذف اطلاعات تماس است.</p>
      <a href="tel:09120000000">۰۹۱۲۰۰۰۰۰۰۰</a>
    </aside>
  </div>
  <section class="description">
    <h2>توضیحات</h2>
    <p>این {listing.property_type} خوش‌نقشه در {listing.neighborhood} تهران برای اجاره عرضه شده است.
    اطلاعات این صفحه کاملا ساختگی و برای نمایش فرایند استخراج ترب‌رنت تهیه شده است.</p>
  </section>
</article>"""


def listing_head(host: str, listing: Listing, *, include_jsonld: bool) -> str:
    structured = (
        f'<script type="application/ld+json">{listing_json_ld(host, listing)}</script>'
        if include_jsonld
        else ""
    )
    return f"""
<meta property="og:title" content="{html.escape(listing.title)}">
<meta property="og:description" content="آگهی اجاره ملک در تهران، {html.escape(listing.neighborhood)}">
<meta property="og:image" content="https://{host}/images/{listing.image}">
<meta property="article:published_time" content="{listing.published_at}">
<meta property="place:location:latitude" content="{listing.latitude}">
<meta property="place:location:longitude" content="{listing.longitude}">
<meta itemprop="floorSize" content="{listing.area}">
<meta itemprop="numberOfBedrooms" content="{listing.bedrooms}">
<link rel="canonical" href="https://{host}/property/{listing.identifier}/">
{structured}"""


def listing_page(host: str, site: Site, listing: Listing) -> str:
    alternate = site.presentation == "mixed" and listing.identifier % 5 == 0
    body = visible_listing(host, site, listing, alternate=alternate)
    include_jsonld = site.presentation in {"jsonld", "mixed"} and not alternate
    page = shell(
        site,
        title=listing.title,
        description=f"اجاره ملک در تهران، {listing.neighborhood}",
        body=body,
    ).replace(
        "</head>",
        listing_head(host, listing, include_jsonld=include_jsonld) + "</head>",
    )
    if site.presentation != "javascript":
        return page
    # The raw response is a true JavaScript shell. Browser rendering inserts the full page.
    head, _separator, _old_body = page.partition("<body>")
    rendered = '<div class="demo-strip">وب‌سایت نمایشی — تمام آگهی‌ها ساختگی هستند</div>'
    rendered += f'<header class="site-header"><a class="brand" href="/">{site.name}</a>'
    rendered += '<nav><a href="/rentals/">رهن و اجاره</a></nav></header><main>'
    rendered += body + "</main>"
    script = f"document.getElementById('root').innerHTML={json.dumps(rendered, ensure_ascii=False)};"
    return f'{head}<body><div id="root"></div><script>{script}</script></body></html>\n'


def card(listing: Listing) -> str:
    return f"""
<article class="property-card">
  <a href="/property/{listing.identifier}/">
    <img src="/images/{listing.image}" alt="" loading="lazy">
    <div class="card-body">
      <p class="eyebrow">تهران، {html.escape(listing.neighborhood)}</p>
      <h2>{html.escape(listing.title)}</h2>
      <p>{listing.bedrooms} اتاق · طبقه {listing.floor} · ساخت {listing.construction_year}</p>
      <strong>{toman(listing.deposit_toman)} ودیعه</strong>
      <span>{toman(listing.rent_toman)} اجاره ماهانه</span>
    </div>
  </a>
</article>"""


def index_json_ld(host: str, listings: list[Listing]) -> str:
    payload = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": position,
                "item": {
                    "@type": listing.schema_type,
                    "url": f"https://{host}/property/{listing.identifier}/",
                    "name": listing.title,
                },
            }
            for position, listing in enumerate(listings, start=1)
        ],
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def rentals_page(
    host: str, site: Site, all_listings: list[Listing], page_number: int
) -> str:
    page_count = math.ceil(len(all_listings) / PAGE_SIZE)
    start = (page_number - 1) * PAGE_SIZE
    listings = all_listings[start : start + PAGE_SIZE]
    pagination = "".join(
        f'<a class="{"current" if number == page_number else ""}" '
        f'href="/rentals/{"" if number == 1 else f"page/{number}/"}">{number}</a>'
        for number in range(1, page_count + 1)
    )
    body = f"""
<section class="index-heading">
  <p class="eyebrow">{len(all_listings)} آگهی فعال نمایشی</p>
  <h1>رهن و اجاره خانه و آپارتمان در تهران</h1>
  <p>آگهی‌های تازه اجاره در محله‌های تهران، صفحه {page_number} از {page_count}</p>
</section>
<section class="property-grid">{"".join(card(item) for item in listings)}</section>
<nav class="pagination" aria-label="صفحه‌بندی">{pagination}</nav>"""
    page = shell(
        site,
        title=f"رهن و اجاره در تهران — صفحه {page_number}",
        description="فهرست آگهی‌های نمایشی اجاره آپارتمان و خانه در تهران",
        body=body,
    )
    if site.presentation == "jsonld":
        page = page.replace(
            "</head>",
            f'<script type="application/ld+json">{index_json_ld(host, listings)}</script></head>',
        )
    if site.presentation != "javascript":
        return page
    head, _separator, _old_body = page.partition("<body>")
    rendered = f'<header class="site-header"><a class="brand" href="/">{site.name}</a>'
    rendered += '<nav><a href="/rentals/">رهن و اجاره</a></nav></header><main>'
    rendered += body + "</main>"
    script = f"document.getElementById('root').innerHTML={json.dumps(rendered, ensure_ascii=False)};"
    return f'{head}<body><div id="root"></div><script>{script}</script></body></html>\n'


def write_page(root: Path, relative: str, content: str) -> None:
    destination = root / relative / "index.html"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content, encoding="utf-8")


def static_page(site: Site, heading: str, paragraphs: list[str]) -> str:
    content = "".join(f"<p>{html.escape(paragraph)}</p>" for paragraph in paragraphs)
    return shell(
        site,
        title=heading,
        description=paragraphs[0],
        body=f'<section class="text-page"><h1>{html.escape(heading)}</h1>{content}</section>',
    )


def write_transport_scenarios(root: Path, site: Site) -> None:
    body = """
<section class="text-page">
  <p class="eyebrow">سناریوهای کنترل‌شده</p>
  <h1>صفحات نمایشی وضعیت دریافت</h1>
  <p>این پیوندها برای نمایش رفتار خزنده در پاسخ‌های ویژه فراهم شده‌اند.</p>
  <ul>
    <li><a href="/demo-status/gone/91001/">آگهی اجاره حذف‌شده با پاسخ 410</a></li>
    <li><a href="/demo-status/temporary-error/91002/">آگهی اجاره با خطای موقت 503</a></li>
    <li><a href="/demo-status/redirect/91003/">آگهی اجاره با تغییر مسیر معتبر</a></li>
    <li><a href="/private/property/91004/">آگهی اجاره منع‌شده در robots.txt</a></li>
  </ul>
</section>"""
    write_page(
        root,
        "scenarios/transport",
        shell(
            site,
            title="سناریوهای دریافت",
            description="سناریوهای دریافت خزنده",
            body=body,
        ),
    )


def write_extraction_scenarios(
    root: Path, host: str, site: Site, listings: list[Listing]
) -> None:
    clean_listing, missing_listing, conflict_listing, drift_listing = listings[:4]
    clean = listing_page(host, site, clean_listing)
    missing = listing_page(host, site, missing_listing)
    missing = missing.replace(
        f"<span>ودیعه {toman(missing_listing.deposit_toman)}</span>",
        "<span>ودیعه نامشخص</span>",
    ).replace(
        f'<tr><th>ودیعه</th><td class="deposit">{toman(missing_listing.deposit_toman)}</td></tr>',
        '<tr><th>ودیعه</th><td class="deposit">نامشخص</td></tr>',
    )
    conflict = listing_page(host, site, conflict_listing).replace(
        f'<td class="area">{conflict_listing.area} متر</td>',
        f'<td class="area">{conflict_listing.area + 37} متر</td>',
    )
    redesign_open = '<div class="redesign-panel">' * 24
    redesign_close = "</div>" * 24
    drift_body = f"""
<article class="new-layout">
  {redesign_open}
  <h1>{html.escape(drift_listing.title)}</h1>
  <p>آگهی اجاره ملک در تهران، منطقه {drift_listing.district}،
  {html.escape(drift_listing.neighborhood)}</p>
  <ul>
    <li>متراژ {drift_listing.area} متر مربع</li>
    <li>{drift_listing.bedrooms} اتاق خواب</li>
    <li>ودیعه {toman(drift_listing.deposit_toman)}</li>
    <li>اجاره ماهانه {toman(drift_listing.rent_toman)}</li>
  </ul>
  <button type="button">تماس با آگهی‌دهنده</button>
  {redesign_close}
</article>"""
    drift = shell(
        site,
        title=drift_listing.title,
        description="ساختار تازه و ناسازگار برای نمایش تشخیص تغییر ساختار",
        body=drift_body,
    )
    pages = {
        "scenario-property/90001/clean": clean,
        "scenario-property/90002/missing-deposit": missing,
        "scenario-property/90003/conflicting-area": conflict,
        "scenario-property/90004/structural-drift": drift,
    }
    for path, content in pages.items():
        write_page(root, path, content)
    links = "".join(
        f'<li><a href="/{path}/">اجاره آپارتمان تهران — {label}</a></li>'
        for path, label in (
            ("scenario-property/90001/clean", "آگهی معتبر"),
            ("scenario-property/90002/missing-deposit", "ودیعه نامشخص"),
            ("scenario-property/90003/conflicting-area", "متراژ متناقض"),
            ("scenario-property/90004/structural-drift", "ساختار تازه"),
        )
    )
    baseline_links = "".join(
        f'<li><a href="/property/{listing.identifier}/">'
        f"اجاره {listing.property_type} تهران — آگهی معتبر {listing.identifier}</a></li>"
        for listing in listings[10:18]
    )
    body = f"""
<section class="text-page">
  <p class="eyebrow">اجرای استخراج پس از تأیید پروفایل</p>
  <h1>آگهی‌های اجاره با نتیجه‌های متفاوت</h1>
  <p>این فهرست چند آگهی معتبر و سه استثنای قابل بررسی برای اپراتور دارد.</p>
  <ul>{baseline_links}{links}</ul>
</section>"""
    write_page(
        root,
        "scenarios/extraction",
        shell(
            site,
            title="سناریوهای استخراج",
            description="آگهی‌های معتبر، ناقص، متناقض و دارای تغییر ساختار",
            body=body,
        ),
    )


def generate_site(output: Path, base_domain: str, site: Site) -> dict[str, object]:
    host = f"{site.key}.{base_domain}"
    root = output / site.key
    listings = make_listings(site)
    write_page(
        root,
        "",
        shell(
            site,
            title="آگهی اجاره ملک در تهران",
            description="وب‌سایت نمایشی آگهی‌های اجاره ملک در تهران",
            body=f"""
<section class="home-intro">
  <div>
    <p class="eyebrow">{site.count} آگهی ساختگی و قابل پیمایش</p>
    <h1>خانه بعدی خود را در تهران پیدا کنید</h1>
    <p>فهرست نمایشی آپارتمان، خانه و ویلا برای رهن و اجاره در محله‌های تهران.</p>
    <a class="primary-action" href="/rentals/">مشاهده آگهی‌های اجاره</a>
  </div>
  <img src="/images/apartment-bright.webp" alt="فضای داخلی یک آپارتمان نمایشی">
</section>""",
        ),
    )
    for page_number in range(1, math.ceil(site.count / PAGE_SIZE) + 1):
        path = "rentals" if page_number == 1 else f"rentals/page/{page_number}"
        write_page(root, path, rentals_page(host, site, listings, page_number))
    for listing in listings:
        write_page(
            root, f"property/{listing.identifier}", listing_page(host, site, listing)
        )
    write_page(
        root,
        "about",
        static_page(
            site,
            "درباره این وب‌سایت",
            [
                "این وب‌سایت یک منبع کاملا ساختگی برای نمایش فرایند معرفی و استخراج ترب‌رنت است.",
                "هیچ ملک، شخص، شماره تماس یا پیشنهاد واقعی در این صفحات وجود ندارد.",
            ],
        ),
    )
    write_page(
        root,
        "contact",
        static_page(
            site,
            "تماس",
            [
                "این صفحه نمایشی است و راه ارتباطی واقعی ارائه نمی‌کند.",
                "برای بررسی حذف اطلاعات تماس، شماره‌های ساختگی داخل آگهی‌ها قرار گرفته‌اند.",
            ],
        ),
    )
    write_transport_scenarios(root, site)
    if site.presentation == "legacy":
        write_extraction_scenarios(root, host, site, listings)
    (root / "robots.txt").write_text(
        "User-agent: TorobRentSourceFetcher\nDisallow: /private/\nAllow: /\n\n"
        "User-agent: *\nDisallow: /\n",
        encoding="utf-8",
    )
    sitemap_urls = [f"https://{host}/rentals/"] + [
        f"https://{host}/property/{listing.identifier}/" for listing in listings
    ]
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    sitemap += "".join(
        f"  <url><loc>{html.escape(url)}</loc></url>\n" for url in sitemap_urls
    )
    sitemap += "</urlset>\n"
    (root / "sitemap.xml").write_text(sitemap, encoding="utf-8")
    return {
        "site": site.key,
        "host": host,
        "name": site.name,
        "listing_count": site.count,
        "presentation": site.presentation,
        "submitted_url": f"https://{host}/rentals/",
        "sitemap_url": f"https://{host}/sitemap.xml",
        "first_listing": f"https://{host}/property/{listings[0].identifier}/",
        "last_listing": f"https://{host}/property/{listings[-1].identifier}/",
    }


def generate(output: Path, base_domain: str) -> None:
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    shutil.copytree(ROOT / "static", output / "shared")
    manifests = []
    for site in SITES:
        manifest = generate_site(output, base_domain, site)
        root = output / site.key
        shutil.copytree(ROOT / "static", root / "assets")
        shutil.copytree(ROOT / "assets", root / "images")
        manifests.append(manifest)
    (output / "manifest.json").write_text(
        json.dumps(
            {
                "generated_for": base_domain,
                "listing_count": sum(site.count for site in SITES),
                "sites": manifests,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--base-domain", default="demo.example.com")
    arguments = parser.parse_args()
    base_domain = arguments.base_domain.strip().strip(".").lower()
    if not base_domain or "/" in base_domain or ":" in base_domain:
        parser.error("--base-domain must be a DNS name without a scheme or port")
    generate(arguments.output.resolve(), base_domain)
    print(
        f"Generated {sum(site.count for site in SITES):,} listings in {arguments.output}"
    )
    for site in SITES:
        print(f"  https://{site.key}.{base_domain}/rentals/ ({site.count} listings)")


if __name__ == "__main__":
    main()
