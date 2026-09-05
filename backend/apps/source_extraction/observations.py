from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from typing import Any, Protocol
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup, Tag

from .normalization import DIGIT_TRANSLATION as PERSIAN_DIGITS
from .normalization import normalize_text

PHONE_RE = re.compile(
    r"(?<!\d)(?:(?:\+98|0098|0)[\s().-]*)?"
    r"(?:9(?:[\s().-]*\d){9}|21(?:[\s().-]*\d){8})(?!\d)"
)
CORE_FIELDS = (
    "city",
    "district",
    "neighborhood",
    "property_type",
    "floor_area_sqm",
    "bedroom_count",
    "deposit_rial",
    "monthly_rent_rial",
)
FEATURE_FIELDS = ("parking", "elevator", "storage", "balcony", "furnished")
ALL_FIELDS = CORE_FIELDS + (
    "construction_year",
    "floor",
    "total_floors",
    "units_per_floor",
    *FEATURE_FIELDS,
    "heating",
    "cooling",
    "is_negotiable",
    "is_convertible",
    "title",
    "description",
    "source_reference",
    "source_url",
    "published_at",
    "availability_confirmed_at",
    "latitude",
    "longitude",
    "source_location_text",
    "image_urls",
)


def redact_phone_numbers(value: str) -> str:
    translated = value.translate(PERSIAN_DIGITS)
    output = value
    for match in reversed(list(PHONE_RE.finditer(translated))):
        output = output[: match.start()] + "[redacted-phone]" + output[match.end() :]
    return output


def redact_candidate(item: FieldCandidate) -> FieldCandidate:
    def clean(value: Any) -> Any:
        if isinstance(value, str):
            return redact_phone_numbers(value)
        if isinstance(value, list):
            return [clean(child) for child in value]
        if isinstance(value, dict):
            return {key: clean(child) for key, child in value.items()}
        return value

    return FieldCandidate(
        field_name=item.field_name,
        raw_value=clean(item.raw_value),
        normalized_value=clean(item.normalized_value),
        confidence=item.confidence,
        source_locator=item.source_locator,
        evidence_snippet=redact_phone_numbers(item.evidence_snippet),
        observer_name=item.observer_name,
    )


def parse_integer(value: Any) -> int | None:
    text = normalize_text(value).replace(",", "").replace("٬", "")
    match = re.search(r"-?\d+", text)
    return int(match.group()) if match else None


def parse_money_rial(value: Any, *, label: str = "") -> int | None:
    text = normalize_text(value)
    if any(word in text for word in ("رایگان", "مجانی")):
        return 0
    if "توافق" in text:
        return None
    match = re.search(r"(\d[\d,٬]*(?:\.\d+)?)\s*(میلیارد|میلیون|هزار)?", text)
    if not match:
        return None
    numeric_text = match.group(1).replace("٬", ",")
    number = float(numeric_text.replace(",", ""))
    multiplier = {"میلیارد": 1_000_000_000, "میلیون": 1_000_000, "هزار": 1_000}.get(
        match.group(2), 1
    )
    amount = int(number * multiplier)
    currency_context = f"{label} {text}".casefold()
    if any(unit in currency_context for unit in ("تومان", "تومن", "toman", "irt")):
        amount *= 10
    return amount


def normalize_property_type(value: Any) -> str | None:
    text = normalize_text(value).casefold()
    aliases = {
        "office": ("دفتر اداری", "اداری", "office"),
        "shop": ("مغازه", "shop", "store"),
        "warehouse": ("انبار", "warehouse"),
        "workshop": ("کارگاه", "workshop"),
        "apartment": ("آپارتمان", "اپارتمان", "apartment", "flat"),
        "villa": ("ویلا", "ویلایی", "villa"),
        "house": ("خانه", "منزل", "کلنگی", "house", "home"),
    }
    for canonical, words in aliases.items():
        if any(word in text for word in words):
            return canonical
    return None


def normalize_feature(value: Any) -> str:
    text = normalize_text(value).casefold()
    if any(word in text for word in ("ندارد", "بدون", "فاقد", "no ", "false")):
        return "absent"
    if any(word in text for word in ("دارد", "موجود", "بله", "yes", "true")):
        return "present"
    return "unknown"


def plausible_profile_value(field_name: str, value: Any) -> bool:
    """Reject cardinality-correct variants that are semantically the wrong field."""
    if field_name == "city":
        return normalize_text(value).casefold() == "تهران"
    if field_name == "district":
        return bool(re.fullmatch(r"منطقه\s+\d{1,2}", normalize_text(value)))
    if field_name == "neighborhood":
        text = normalize_text(value)
        return 2 <= len(text) <= 100 and "تهران" not in text and "پیش" not in text
    if field_name == "property_type":
        return value in {"apartment", "house", "villa", "office", "shop", "warehouse", "workshop"}
    if field_name == "floor_area_sqm":
        return isinstance(value, int) and 5 <= value <= 100_000
    if field_name == "bedroom_count":
        return isinstance(value, int) and 0 <= value <= 100
    if field_name in {"deposit_rial", "monthly_rent_rial"}:
        return isinstance(value, int) and 0 <= value <= 10**17
    return True


@dataclass(frozen=True)
class FieldCandidate:
    field_name: str
    raw_value: Any
    normalized_value: Any
    confidence: float
    source_locator: str
    evidence_snippet: str
    observer_name: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Resolution:
    values: dict[str, Any]
    accepted: dict[str, FieldCandidate]
    conflicts: dict[str, list[Any]]
    unresolved: list[str]
    status: str
    source_claims: dict[str, list[Any]] = field(default_factory=dict)


class Observer(Protocol):
    name: str

    def observe(self, url: str, html: str) -> list[FieldCandidate]: ...


def candidate(
    field_name: str,
    raw: Any,
    normalized: Any,
    confidence: float,
    locator: str,
    evidence: str,
    observer: str,
) -> FieldCandidate | None:
    if normalized is None or normalized == "":
        return None
    return FieldCandidate(
        field_name=field_name,
        raw_value=raw,
        normalized_value=normalized,
        confidence=confidence,
        source_locator=locator,
        evidence_snippet=normalize_text(evidence)[:500],
        observer_name=observer,
    )


def _walk_json(value: Any, path: str = "$") -> Iterable[tuple[str, dict[str, Any]]]:
    if isinstance(value, dict):
        yield path, value
        for key, child in value.items():
            yield from _walk_json(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _walk_json(child, f"{path}[{index}]")


STRUCTURED_LISTING_TYPES = {
    "accommodation",
    "apartment",
    "house",
    "offer",
    "product",
    "realestatelisting",
    "residence",
    "singlefamilyresidence",
}
STRUCTURED_LISTING_KEYS = {
    "address",
    "floorSize",
    "itemOffered",
    "numberOfBedrooms",
    "numberOfRooms",
    "offers",
    "priceSpecification",
}
STRUCTURED_CHILD_KEYS = {
    "additionalProperty",
    "address",
    "amenityFeature",
    "floorSize",
    "geo",
    "itemOffered",
    "mainEntity",
    "offers",
    "priceComponent",
    "priceSpecification",
}


def _structured_types(item: dict[str, Any]) -> set[str]:
    raw_types = item.get("@type", ())
    if isinstance(raw_types, str):
        return {raw_types.casefold()}
    if isinstance(raw_types, list):
        return {str(value).casefold() for value in raw_types}
    return set()


def _is_listing_structured_item(item: dict[str, Any]) -> bool:
    return bool(_structured_types(item) & STRUCTURED_LISTING_TYPES) or bool(
        STRUCTURED_LISTING_KEYS & item.keys()
    )


def _same_page_claim(page_url: str, raw_url: Any) -> bool:
    if not isinstance(raw_url, str) or not raw_url.strip():
        return False
    expected = urlsplit(page_url)
    claimed = urlsplit(urljoin(page_url, raw_url))
    return claimed.netloc.casefold() == expected.netloc.casefold() and claimed.path.rstrip(
        "/"
    ) == expected.path.rstrip("/")


def _structured_roots(payload: Any, page_url: str) -> list[tuple[str, dict[str, Any]]]:
    candidates = [
        (path, item) for path, item in _walk_json(payload) if _is_listing_structured_item(item)
    ]
    exact = [
        (path, item)
        for path, item in candidates
        if _same_page_claim(
            page_url,
            item.get("url")
            or item.get("@id")
            or (
                item.get("mainEntityOfPage", {}).get("@id")
                if isinstance(item.get("mainEntityOfPage"), dict)
                else item.get("mainEntityOfPage")
            ),
        )
    ]
    if exact:
        shallowest = min(path.count(".") + path.count("[") for path, _item in exact)
        return [
            (path, item) for path, item in exact if path.count(".") + path.count("[") == shallowest
        ]
    if isinstance(payload, dict) and _is_listing_structured_item(payload):
        return [("$", payload)]
    direct: list[tuple[str, dict[str, Any]]] = []
    if isinstance(payload, list):
        values = payload
    elif isinstance(payload, dict):
        values = payload.get("@graph", [])
    else:
        values = []
    if isinstance(values, list):
        direct = [
            (f"$[{index}]", item)
            for index, item in enumerate(values)
            if isinstance(item, dict) and _is_listing_structured_item(item)
        ]
    return direct if len(direct) == 1 else []


def _walk_listing_json(value: Any, path: str = "$") -> Iterable[tuple[str, dict[str, Any]]]:
    if isinstance(value, dict):
        yield path, value
        for key, child in value.items():
            if key in STRUCTURED_CHILD_KEYS:
                yield from _walk_listing_json(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _walk_listing_json(child, f"{path}[{index}]")


class StructuredDataObserver:
    name = "structured_data"

    def observe(self, url: str, html: str) -> list[FieldCandidate]:
        soup = BeautifulSoup(html, "html.parser")
        output: list[FieldCandidate] = []
        payloads: list[tuple[str, Any]] = []
        for index, script in enumerate(soup.find_all("script")):
            raw = script.string or script.get_text()
            if not raw or len(raw) > 1_000_000:
                continue
            script_type = str(script.get("type", "")).casefold()
            if "json" not in script_type and not raw.lstrip().startswith(("{", "[")):
                continue
            try:
                payloads.append((f"script[{index}]", json.loads(raw)))
            except json.JSONDecodeError, TypeError:
                continue

        for script_path, payload in payloads:
            for path, item in (
                pair
                for root_path, root in _structured_roots(payload, url)
                for pair in _walk_listing_json(root, f"{script_path}:{root_path}")
            ):
                evidence = json.dumps(item, ensure_ascii=False)[:500]
                mappings: list[tuple[str, Any, Any]] = [
                    (
                        "title",
                        item.get("name") or item.get("title"),
                        item.get("name") or item.get("title"),
                    ),
                    ("description", item.get("description"), item.get("description")),
                    (
                        "bedroom_count",
                        item.get("numberOfRooms") or item.get("numberOfBedrooms"),
                        parse_integer(item.get("numberOfRooms") or item.get("numberOfBedrooms")),
                    ),
                    (
                        "property_type",
                        item.get("@type") or item.get("accommodationCategory"),
                        normalize_property_type(
                            item.get("@type") or item.get("accommodationCategory")
                        ),
                    ),
                    (
                        "published_at",
                        item.get("datePosted") or item.get("datePublished"),
                        item.get("datePosted") or item.get("datePublished"),
                    ),
                ]
                floor_size = item.get("floorSize")
                if isinstance(floor_size, dict):
                    mappings.append((
                        "floor_area_sqm",
                        floor_size.get("value"),
                        parse_integer(floor_size.get("value")),
                    ))
                elif floor_size is not None:
                    mappings.append(("floor_area_sqm", floor_size, parse_integer(floor_size)))
                address = item.get("address")
                if isinstance(address, dict):
                    location = "، ".join(
                        str(address.get(key))
                        for key in ("addressLocality", "addressRegion", "streetAddress")
                        if address.get(key)
                    )
                    mappings.append(("source_location_text", location, normalize_text(location)))
                geo = item.get("geo")
                if isinstance(geo, dict):
                    mappings.extend((
                        ("latitude", geo.get("latitude"), geo.get("latitude")),
                        ("longitude", geo.get("longitude"), geo.get("longitude")),
                    ))
                images = item.get("image")
                if isinstance(images, str):
                    images = [images]
                if isinstance(images, list):
                    urls = [
                        str(image.get("url") if isinstance(image, dict) else image)
                        for image in images
                    ]
                    urls = [image for image in urls if image.startswith(("http://", "https://"))]
                    mappings.append(("image_urls", images, urls))
                offers = item.get("offers")
                if isinstance(offers, dict) and offers.get("price") is not None:
                    label = str(offers.get("priceCurrency", ""))
                    amount = parse_money_rial(offers["price"], label=label)
                    mappings.append(("monthly_rent_rial", offers["price"], amount))
                price_type = normalize_text(
                    item.get("priceType") or item.get("name") or ""
                ).casefold()
                price_field = None
                deposit_terms = ("deposit", "security deposit", "ودیعه", "رهن")
                if any(term in price_type for term in deposit_terms):
                    price_field = "deposit_rial"
                elif any(term in price_type for term in ("rent", "monthly", "اجاره")):
                    price_field = "monthly_rent_rial"
                if price_field and item.get("price") is not None:
                    currency = str(item.get("priceCurrency") or "")
                    mappings.append((
                        price_field,
                        item["price"],
                        parse_money_rial(item["price"], label=currency),
                    ))
                for field_name, raw, normalized in mappings:
                    found = candidate(field_name, raw, normalized, 0.94, path, evidence, self.name)
                    if found:
                        output.append(found)

        output.append(
            FieldCandidate("source_url", url, url, 1.0, "request.final_url", url, self.name)
        )
        output.append(
            FieldCandidate(
                "source_reference",
                urlsplit(url).path.rstrip("/").split("/")[-1],
                urlsplit(url).path.rstrip("/").split("/")[-1],
                0.99,
                "request.final_url",
                url,
                self.name,
            )
        )
        return _deduplicate(output)


LABEL_FIELDS: dict[str, tuple[str, ...]] = {
    "floor_area_sqm": ("متراژ", "مساحت", "زیربنا"),
    "bedroom_count": ("اتاق", "تعداد اتاق", "اتاق خواب"),
    "construction_year": ("سال ساخت",),
    "floor": ("طبقه",),
    "total_floors": ("تعداد طبقات", "کل طبقات"),
    "units_per_floor": ("واحد در طبقه", "تعداد واحد در طبقه"),
    "deposit_rial": ("ودیعه", "رهن"),
    "monthly_rent_rial": ("اجاره ماهانه", "اجاره"),
    "source_location_text": ("موقعیت", "محله", "آدرس"),
    "heating": ("گرمایش", "سیستم گرمایشی"),
    "cooling": ("سرمایش", "سیستم سرمایشی"),
}
FEATURE_LABELS = {
    "parking": ("پارکینگ",),
    "elevator": ("آسانسور", "اسانـسور"),
    "storage": ("انباری",),
    "balcony": ("بالکن", "تراس"),
    "furnished": ("مبله", "اثاثیه"),
}


def _normalize_by_field(field_name: str, raw: Any, label: str = "") -> Any:
    if field_name in {
        "floor_area_sqm",
        "bedroom_count",
        "construction_year",
        "floor",
        "total_floors",
        "units_per_floor",
    }:
        return parse_integer(raw)
    if field_name in {"deposit_rial", "monthly_rent_rial"}:
        return parse_money_rial(raw, label=label)
    if field_name in FEATURE_FIELDS:
        return normalize_feature(raw)
    if field_name == "property_type":
        return normalize_property_type(raw)
    if field_name in {"is_negotiable", "is_convertible"}:
        text = normalize_text(raw).casefold()
        if any(value in text for value in ("بله", "دارد", "هست", "yes", "true")):
            return True
        if any(value in text for value in ("خیر", "نیست", "ندارد", "no", "false")):
            return False
        return None
    if field_name in {"latitude", "longitude"}:
        match = re.search(r"-?\d+(?:\.\d+)?", normalize_text(raw))
        return float(match.group()) if match else None
    if field_name == "image_urls":
        values = raw if isinstance(raw, list) else [raw]
        return [
            match.group()
            for value in values
            for match in re.finditer(r"https?://[^\s'\"<>]+", str(value))
        ]
    return normalize_text(raw)


def extract_label_value_pairs(soup: BeautifulSoup) -> list[tuple[str, str, str]]:
    pairs: list[tuple[str, str, str]] = []
    for table in soup.find_all("table"):
        headers = table.select("thead th")
        values = table.select("tbody td")
        if not headers or len(headers) != len(values) or len(headers) > 20:
            continue
        for label, value in zip(headers, values, strict=True):
            label_text = normalize_text(label.get_text(" ", strip=True))
            value_text = normalize_text(value.get_text(" ", strip=True))
            if label_text and value_text:
                pairs.append((label_text, value_text, _css_path(value)))
    for label in soup.find_all(["dt", "th"]):
        sibling = label.find_next_sibling(["dd", "td"])
        if sibling:
            pairs.append((
                normalize_text(label.get_text(" ", strip=True)),
                normalize_text(sibling.get_text(" ", strip=True)),
                _css_path(sibling),
            ))
    for row in soup.find_all(["tr", "li", "div"]):
        direct = [child for child in row.find_all(recursive=False) if isinstance(child, Tag)]
        if len(direct) != 2:
            continue
        texts = [normalize_text(child.get_text(" ", strip=True)) for child in direct]
        if (
            texts[0]
            and texts[-1]
            and texts[0] != texts[-1]
            and len(texts[0]) <= 80
            and len(texts[-1]) <= 200
        ):
            pairs.append((texts[0], texts[-1], _css_path(direct[-1])))
    return list(dict.fromkeys(pairs))


def _matches_field_label(label: str, aliases: tuple[str, ...]) -> bool:
    """Match a compact field label without treating a whole listing card as a label."""
    text = normalize_text(label).casefold().strip(" :：-")
    for alias in aliases:
        normalized_alias = normalize_text(alias).casefold()
        if re.fullmatch(
            rf"(?:مبلغ\s+)?{re.escape(normalized_alias)}"
            r"(?:\s*(?:\([^)]{1,30}\)|تومان|تومن|ریال))?",
            text,
        ):
            return True
    return False


def _css_path(tag: Tag) -> str:
    if tag.get("id"):
        return f"#{tag['id']}"
    raw_classes = tag.get("class")
    classes = (
        [str(name) for name in raw_classes if re.fullmatch(r"[a-zA-Z_-][\w-]{1,80}", str(name))]
        if isinstance(raw_classes, list)
        else []
    )
    if classes:
        return f"{tag.name}." + ".".join(classes[:3])
    return tag.name


class DomLabelObserver:
    name = "dom_labels"

    def observe(self, url: str, html: str) -> list[FieldCandidate]:
        soup = BeautifulSoup(html, "html.parser")
        output: list[FieldCandidate] = []
        title = soup.find("h1") or soup.find("title")
        if title:
            raw = title.get_text(" ", strip=True)
            output.append(
                FieldCandidate(
                    "title", raw, normalize_text(raw), 0.9, _css_path(title), raw, self.name
                )
            )
            property_type = candidate(
                "property_type",
                raw,
                normalize_property_type(raw),
                0.82,
                _css_path(title),
                raw,
                self.name,
            )
            if property_type:
                output.append(property_type)
        description = soup.select_one("meta[name='description']")
        if description and description.get("content"):
            raw = str(description["content"])
            output.append(
                FieldCandidate(
                    "description",
                    raw,
                    normalize_text(raw),
                    0.8,
                    "meta[name=description]@content",
                    raw,
                    self.name,
                )
            )
        for breadcrumb in soup.select("[class*='breadcrumb'] a, nav[aria-label*='breadcrumb' i] a"):
            raw = breadcrumb.get_text(" ", strip=True)
            normalized = normalize_property_type(raw)
            if normalized:
                output.append(
                    FieldCandidate(
                        "property_type",
                        raw,
                        normalized,
                        0.9,
                        _css_path(breadcrumb),
                        raw,
                        self.name,
                    )
                )
        for node in soup.find_all(["p", "li", "span"]):
            raw = normalize_text(node.get_text(" ", strip=True))
            if not 4 <= len(raw) <= 200 or not _contains_city_tehran(raw):
                continue
            if re.search(r"(?:^|\s)در\s+تهران(?:[،,]|$)", raw):
                output.append(
                    FieldCandidate(
                        "source_location_text",
                        raw,
                        raw,
                        0.86,
                        _css_path(node),
                        raw,
                        self.name,
                    )
                )
        for label, raw, locator in extract_label_value_pairs(soup):
            for field_name, aliases in LABEL_FIELDS.items():
                if _matches_field_label(label, aliases):
                    value = _normalize_by_field(field_name, raw, label)
                    found = candidate(
                        field_name, raw, value, 0.88, locator, f"{label}: {raw}", self.name
                    )
                    if found:
                        output.append(found)
                    break
            for field_name, aliases in FEATURE_LABELS.items():
                if _matches_field_label(label, aliases):
                    value = normalize_feature(raw)
                    if value == "unknown" and normalize_text(raw):
                        value = "present"
                    output.append(
                        FieldCandidate(
                            field_name, raw, value, 0.9, locator, f"{label}: {raw}", self.name
                        )
                    )
        return _deduplicate(output)


class MetadataObserver:
    """Extract common declarative HTML metadata without site-specific code."""

    name = "metadata"

    META_FIELDS: dict[str, tuple[str, ...]] = {
        "title": ("og:title", "twitter:title", "title"),
        "description": ("description", "og:description", "twitter:description"),
        "published_at": ("article:published_time", "date", "datePublished"),
        "image_urls": ("og:image", "twitter:image", "image"),
        "latitude": ("place:location:latitude", "latitude"),
        "longitude": ("place:location:longitude", "longitude"),
    }

    def observe(self, url: str, html: str) -> list[FieldCandidate]:
        soup = BeautifulSoup(html, "html.parser")
        output: list[FieldCandidate] = []
        for field_name, aliases in self.META_FIELDS.items():
            for alias in aliases:
                nodes = soup.select(
                    f'meta[name="{alias}"], meta[property="{alias}"], meta[itemprop="{alias}"]'
                )
                for node in nodes:
                    raw = node.get("content")
                    if not raw:
                        continue
                    normalized = _normalize_by_field(field_name, raw)
                    found = candidate(
                        field_name,
                        raw,
                        normalized,
                        0.9,
                        _css_path(node) + "@content",
                        str(raw),
                        self.name,
                    )
                    if found:
                        output.append(found)
        for field_name, itemprop in (
            ("floor_area_sqm", "floorSize"),
            ("bedroom_count", "numberOfRooms"),
            ("bedroom_count", "numberOfBedrooms"),
        ):
            for node in soup.select(f'meta[itemprop="{itemprop}"]'):
                raw = node.get("content")
                normalized = _normalize_by_field(field_name, raw)
                if raw and normalized is not None:
                    output.append(
                        FieldCandidate(
                            field_name,
                            raw,
                            normalized,
                            0.91,
                            f'meta[itemprop="{itemprop}"]@content',
                            str(raw),
                            self.name,
                        )
                    )
        return _deduplicate(output)


class PersianTextObserver:
    name = "persian_text"

    def observe(self, url: str, html: str) -> list[FieldCandidate]:
        soup = BeautifulSoup(html, "html.parser")
        for unwanted in soup(["script", "style", "noscript"]):
            unwanted.decompose()
        text = normalize_text(soup.get_text(" ", strip=True))
        output: list[FieldCandidate] = []
        patterns = {
            "floor_area_sqm": r"(?:متراژ|مساحت|زیربنا)\s*[:：]?\s*(\d{1,5})",
            "bedroom_count": r"(?:تعداد\s*)?(?:اتاق(?:\s*خواب)?)\s*[:：]?\s*(\d{1,2})",
            "construction_year": r"سال\s*ساخت\s*[:：]?\s*(\d{4})",
            "floor": r"طبقه\s*[:：]?\s*(-?\d{1,3})",
        }
        for field_name, pattern in patterns.items():
            match = re.search(pattern, text)
            if match:
                output.append(
                    FieldCandidate(
                        field_name,
                        match.group(1),
                        parse_integer(match.group(1)),
                        0.76,
                        "visible_text",
                        match.group(0),
                        self.name,
                    )
                )
        for field_name, labels in (
            ("deposit_rial", ("ودیعه", "رهن")),
            ("monthly_rent_rial", ("اجاره ماهانه", "اجاره")),
        ):
            for label in labels:
                match = re.search(
                    rf"{label}\s*(?:\(?(تومان|تومن|ریال)\)?)?\s*[:：]?\s*"
                    r"(\d[\d,٬]*(?:\.\d+)?\s*(?:میلیارد|میلیون|هزار)?"
                    r"(?:\s*(?:تومان|تومن|ریال))?)",
                    text,
                )
                if match:
                    raw = match.group(2)
                    output.append(
                        FieldCandidate(
                            field_name,
                            raw,
                            parse_money_rial(raw, label=f"{label} {match.group(1) or ''}"),
                            0.8,
                            "visible_text",
                            match.group(0),
                            self.name,
                        )
                    )
                    break
        property_type = normalize_property_type(text[:1000])
        found = candidate(
            "property_type", text[:300], property_type, 0.66, "visible_text", text[:300], self.name
        )
        if found:
            output.append(found)
        location_match = re.search(
            r"(?:در|موقعیت|محله)\s+([^،|]{2,80}(?:،\s*[^،|]{2,60}){0,2})", text
        )
        if location_match:
            raw = location_match.group(1)
            output.append(
                FieldCandidate(
                    "source_location_text",
                    raw,
                    normalize_text(raw),
                    0.68,
                    "visible_text",
                    location_match.group(0),
                    self.name,
                )
            )
        for field_name, aliases in FEATURE_LABELS.items():
            for alias in aliases:
                match = re.search(
                    rf"(?:بدون|فاقد)\s+{alias}|{alias}\s*[:：]?\s*(?:ندارد|دارد|بله|خیر)", text
                )
                if match:
                    output.append(
                        FieldCandidate(
                            field_name,
                            match.group(0),
                            normalize_feature(match.group(0)),
                            0.78,
                            "visible_text",
                            match.group(0),
                            self.name,
                        )
                    )
                    break
        return _deduplicate(output)


@dataclass(frozen=True)
class TehranLocation:
    city: str
    district: str
    neighborhood: str
    source_code: str
    provenance_url: str
    source_year: int


class LocationObserver:
    name = "location_catalog"

    def __init__(self, locations: list[TehranLocation]) -> None:
        self.locations = locations

    def observe_candidates(
        self, observations: list[FieldCandidate], html: str
    ) -> list[FieldCandidate]:
        del html  # Location evidence must come from a field observer, never the whole document.
        source_candidates = [
            item
            for item in observations
            if item.field_name == "source_location_text"
            and item.observer_name
            in {"structured_data", "dom_labels", "persian_text", "approved_profile"}
        ]
        if not source_candidates:
            return []

        # A structured address is the most authoritative page-local location claim. If it
        # exists, lower-trust text can corroborate the city but cannot replace its locality.
        structured = [item for item in source_candidates if item.observer_name == "structured_data"]
        if structured:
            shallowest = min(
                item.source_locator.count(".") + item.source_locator.count("[")
                for item in structured
            )
            locality_sources = [
                item
                for item in structured
                if item.source_locator.count(".") + item.source_locator.count("[") == shallowest
            ]
        else:
            locality_sources = source_candidates
        city_is_tehran = any(
            _contains_city_tehran(item.normalized_value) for item in source_candidates
        )
        if not city_is_tehran:
            return []

        matches: dict[str, tuple[TehranLocation, FieldCandidate]] = {}
        for source in locality_sources:
            haystack = _location_key(source.normalized_value)
            for location in self.locations:
                neighborhood = _location_key(location.neighborhood)
                if neighborhood and neighborhood in haystack:
                    matches.setdefault(location.source_code, (location, source))
        if not matches:
            return []
        longest = max(
            len(_location_key(location.neighborhood)) for location, _source in matches.values()
        )
        best_matches = [
            match
            for match in matches.values()
            if len(_location_key(match[0].neighborhood)) == longest
        ]
        if len(best_matches) != 1:
            return []
        location, source = best_matches[0]
        evidence = (
            f"{source.evidence_snippet} · catalog {location.neighborhood}, "
            f"{location.district}, تهران"
        )
        locator = f"{source.source_locator} -> tehran_catalog:{location.source_code}"
        return [
            FieldCandidate(
                "city", source.raw_value, location.city, 0.99, locator, evidence, self.name
            ),
            FieldCandidate(
                "district", source.raw_value, location.district, 0.99, locator, evidence, self.name
            ),
            FieldCandidate(
                "neighborhood",
                source.raw_value,
                location.neighborhood,
                0.99,
                locator,
                evidence,
                self.name,
            ),
        ]

    def eligibility(
        self,
        url: str,
        html: str,
        observations: list[FieldCandidate],
        *,
        context_url: str | None = None,
        trusted_tehran_context: bool = False,
    ) -> str:
        """Decide Tehran scope, allowing a trusted rental index to supply context.

        Detail URLs are often opaque and their initial HTTP response may only be a
        JavaScript shell. A direct parent rental index whose URL explicitly names
        Tehran is useful positive evidence, but page-local structured or labeled
        location claims always take precedence so cross-city recommendations cannot
        silently enter the Tehran dataset.
        """
        location = self.observe_candidates(observations, html)
        if location:
            return "tehran"
        del html
        has_tehran_context = trusted_tehran_context or bool(
            context_url and url_mentions_tehran(context_url)
        )
        location_claims = [
            item
            for item in observations
            if item.field_name == "source_location_text"
            and item.observer_name in {"structured_data", "dom_labels", "persian_text"}
        ]
        structured_claims = [
            item for item in location_claims if item.observer_name == "structured_data"
        ]
        if structured_claims:
            if any(_contains_city_tehran(item.normalized_value) for item in structured_claims):
                return "tehran" if has_tehran_context else "ambiguous"
            return "out_of_scope"
        labeled_claims = [item for item in location_claims if item.observer_name == "dom_labels"]
        if labeled_claims:
            if any(_contains_city_tehran(item.normalized_value) for item in labeled_claims):
                return "tehran" if has_tehran_context else "ambiguous"
            return "out_of_scope"
        if has_tehran_context:
            return "tehran"
        if any(_contains_city_tehran(item.normalized_value) for item in location_claims):
            return "ambiguous"
        if location_claims:
            return "ambiguous"
        if url_mentions_tehran(url):
            return "ambiguous"
        return "ambiguous"


def _location_key(value: Any) -> str:
    """Tolerate Persian spacing variants without weakening page-local evidence rules."""
    return re.sub(r"[\s\u200c\-_,،/]+", "", normalize_text(value).casefold())


def _contains_city_tehran(value: Any) -> bool:
    text = normalize_text(value).casefold()
    return bool(re.search(r"(?:^|[\s،,|/\-])تهران(?:$|[\s،,|/\-])", text))


def url_mentions_tehran(url: str) -> bool:
    """Recognize a standalone Tehran location token in a URL path or query."""
    parts = urlsplit(unquote(url))
    location_text = normalize_text(f"{parts.path} {parts.query}").casefold()
    return bool(
        re.search(
            r"(?:^|[\s/_.?&=,،|\-])(?:tehran|تهران)(?:$|[\s/_.?&=,،|\-])",
            location_text,
        )
    )


ALLOWLISTED_TRANSFORMS = {"text", "integer", "money_rial", "property_type", "feature", "url_list"}


class ApprovedProfileObserver:
    name = "approved_profile"

    def __init__(self, mapping: dict[str, Any], *, _single_variant: bool = False) -> None:
        self.mapping = mapping
        self._single_variant = _single_variant

    def observe(self, url: str, html: str) -> list[FieldCandidate]:
        if not self._single_variant:
            ordered: list[FieldCandidate] = []
            for field_name, field_mapping in self.mapping.items():
                raw_variants = (
                    field_mapping.get("variants") if isinstance(field_mapping, dict) else None
                )
                variants: list[Any] = (
                    raw_variants if isinstance(raw_variants, list) else [field_mapping]
                )
                for variant in variants:
                    found = ApprovedProfileObserver(
                        {field_name: variant}, _single_variant=True
                    ).observe(url, html)
                    variant_values = {
                        json.dumps(item.normalized_value, ensure_ascii=False, sort_keys=True)
                        for item in found
                    }
                    if len(variant_values) == 1 and plausible_profile_value(
                        field_name, found[0].normalized_value
                    ):
                        ordered.extend(found)
                        break
            return _deduplicate(ordered)
        soup = BeautifulSoup(html, "html.parser")
        output: list[FieldCandidate] = []
        for field_name, rule in self.mapping.items():
            if field_name not in ALL_FIELDS or not isinstance(rule, dict):
                continue
            selector = rule.get("selector")
            kind = rule.get("kind", "css")
            transform = rule.get("transform", "text")
            attribute = rule.get("attribute")
            if transform not in ALLOWLISTED_TRANSFORMS:
                continue
            raw_values: list[str] = []
            currency_hint = str(rule.get("currency_hint") or "")
            if kind == "json":
                path = rule.get("path")
                script_selector = rule.get("script_selector") or (
                    "script[type='application/ld+json']"
                )
                if not isinstance(path, str):
                    continue
                try:
                    scripts = soup.select(script_selector)
                except Exception:
                    continue
                for script in scripts[:30]:
                    raw_json = script.string or script.get_text()
                    if not raw_json or not raw_json.lstrip().startswith(("{", "[")):
                        continue
                    try:
                        payload = json.loads(raw_json)
                        raw_values.extend(str(value) for value in _json_path_values(payload, path))
                        currency_path = rule.get("currency_path")
                        if isinstance(currency_path, str):
                            currencies = _json_path_values(payload, currency_path)
                            if currencies:
                                currency_hint = str(currencies[0])
                    except json.JSONDecodeError, TypeError:
                        continue
                locator = f"{script_selector} → {path}"
            elif kind == "css":
                if not isinstance(selector, str):
                    continue
                try:
                    nodes = soup.select(selector)
                except Exception:
                    continue
                for node in nodes[:30]:
                    raw = node.get(attribute) if attribute else node.get_text(" ", strip=True)
                    if raw:
                        raw_values.append(str(raw))
                locator = selector + (f"@{attribute}" if attribute else "")
            elif kind == "label_value":
                container_selector = rule.get("container_selector")
                label_selector = rule.get("label_selector")
                value_selector = rule.get("value_selector")
                aliases = rule.get("label_aliases")
                if not (
                    isinstance(container_selector, str)
                    and isinstance(label_selector, str)
                    and isinstance(value_selector, str)
                    and isinstance(aliases, list)
                ):
                    continue
                try:
                    containers = soup.select(container_selector)
                except Exception:
                    continue
                for container in containers[:100]:
                    label_node = container.select_one(label_selector)
                    value_node = container.select_one(value_selector)
                    if not label_node or not value_node:
                        continue
                    label_text = normalize_text(label_node.get_text(" ", strip=True))
                    if not _matches_rule_label(label_text, aliases):
                        continue
                    raw = (
                        value_node.get(attribute)
                        if attribute
                        else value_node.get_text(" ", strip=True)
                    )
                    if raw:
                        raw_values.append(str(raw))
                locator = f"{container_selector} label({label_selector}) → value({value_selector})"
            elif kind == "table_column":
                container_selector = rule.get("container_selector")
                header_selector = rule.get("header_selector") or "thead th"
                value_selector = rule.get("value_selector") or "tbody td"
                aliases = rule.get("label_aliases")
                if not isinstance(container_selector, str) or not isinstance(aliases, list):
                    continue
                try:
                    containers = soup.select(container_selector)
                except Exception:
                    continue
                for container in containers[:50]:
                    try:
                        headers = container.select(str(header_selector))
                        value_nodes = container.select(str(value_selector))
                    except Exception:
                        continue
                    for index, header in enumerate(headers):
                        if index >= len(value_nodes):
                            break
                        header_text = normalize_text(header.get_text(" ", strip=True))
                        if not _matches_rule_label(header_text, aliases):
                            continue
                        value_node = value_nodes[index]
                        raw = (
                            value_node.get(attribute)
                            if attribute
                            else value_node.get_text(" ", strip=True)
                        )
                        if raw:
                            raw_values.append(str(raw))
                locator = (
                    f"{container_selector} header({header_selector}) → column({value_selector})"
                )
            else:
                continue
            if not raw_values:
                continue
            values: list[Any] = [raw_values] if transform == "url_list" else raw_values
            for raw in values:
                normalized_value: Any
                if transform == "integer":
                    normalized_value = parse_integer(raw)
                elif transform == "money_rial":
                    normalized_value = parse_money_rial(raw, label=currency_hint)
                elif transform == "property_type":
                    normalized_value = normalize_property_type(raw)
                elif transform == "feature":
                    normalized_value = normalize_feature(raw)
                elif transform == "url_list":
                    normalized_value = [
                        value for value in raw_values if value.startswith(("http://", "https://"))
                    ]
                else:
                    normalized_value = normalize_text(raw)
                profile_candidate = candidate(
                    field_name,
                    raw,
                    normalized_value,
                    0.96,
                    locator,
                    str(raw),
                    self.name,
                )
                if profile_candidate:
                    output.append(profile_candidate)
        return _deduplicate(output)


PROFILE_TRANSFORMS: dict[str, str] = {
    **{
        name: "integer"
        for name in (
            "floor_area_sqm",
            "bedroom_count",
            "construction_year",
            "floor",
            "total_floors",
            "units_per_floor",
        )
    },
    "deposit_rial": "money_rial",
    "monthly_rent_rial": "money_rial",
    "property_type": "property_type",
    **{name: "feature" for name in FEATURE_FIELDS},
    "image_urls": "url_list",
}


def _rule(field_name: str, priority: int, origin: str, **values: Any) -> dict[str, Any]:
    return {
        **values,
        "transform": PROFILE_TRANSFORMS.get(field_name, "text"),
        "origin": origin,
        "priority": priority,
    }


def _deterministic_rule_candidates() -> dict[str, list[dict[str, Any]]]:
    json_rules: dict[str, tuple[tuple[str, str], ...]] = {
        "title": (("$.name", "text"), ("$.title", "text")),
        "description": (("$.description", "text"),),
        "property_type": (
            ("$.@type", "property_type"),
            ("$.accommodationCategory", "property_type"),
        ),
        "floor_area_sqm": (("$.floorSize.value", "integer"), ("$.floorSize", "integer")),
        "bedroom_count": (("$.numberOfRooms", "integer"), ("$.numberOfBedrooms", "integer")),
        "published_at": (("$.datePosted", "text"), ("$.datePublished", "text")),
        "latitude": (("$.geo.latitude", "text"),),
        "longitude": (("$.geo.longitude", "text"),),
        "image_urls": (("$.image", "url_list"),),
        "monthly_rent_rial": (("$.offers.price", "money_rial"),),
    }
    output: dict[str, list[dict[str, Any]]] = {}
    for field_name, paths in json_rules.items():
        for path, transform in paths:
            candidate_rule = _rule(
                field_name,
                10,
                "jsonld",
                kind="json",
                path=path,
                script_selector="script[type='application/ld+json']",
            )
            candidate_rule["transform"] = transform
            if field_name == "monthly_rent_rial":
                candidate_rule["currency_path"] = "$.offers.priceCurrency"
            output.setdefault(field_name, []).append(candidate_rule)

    metadata: dict[str, tuple[str, ...]] = {
        "title": ("og:title", "twitter:title", "title"),
        "description": ("description", "og:description", "twitter:description"),
        "published_at": ("article:published_time", "date", "datePublished"),
        "image_urls": ("og:image", "twitter:image", "image"),
        "latitude": ("place:location:latitude", "latitude"),
        "longitude": ("place:location:longitude", "longitude"),
    }
    for field_name, aliases in metadata.items():
        for alias in aliases:
            for attribute in ("name", "property", "itemprop"):
                output.setdefault(field_name, []).append(
                    _rule(
                        field_name,
                        20,
                        "metadata",
                        kind="css",
                        selector=f'meta[{attribute}="{alias}"]',
                        attribute="content",
                    )
                )
    for field_name, itemprop in (
        ("floor_area_sqm", "floorSize"),
        ("bedroom_count", "numberOfRooms"),
        ("bedroom_count", "numberOfBedrooms"),
    ):
        output.setdefault(field_name, []).append(
            _rule(
                field_name,
                20,
                "metadata",
                kind="css",
                selector=f'meta[itemprop="{itemprop}"]',
                attribute="content",
            )
        )
    output.setdefault("title", []).append(
        _rule("title", 40, "stable_dom", kind="css", selector="h1")
    )
    return output


def build_deterministic_profile(
    pages: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build an ordered reusable mapping without network or model access."""
    candidates = _deterministic_rule_candidates()
    dom_observer = DomLabelObserver()
    for page in pages:
        for observation in dom_observer.observe(page["final_url"], page["html"]):
            locator = observation.source_locator
            if (
                observation.field_name not in ALL_FIELDS
                or not locator
                or locator in {"visible_text", "request.final_url"}
                or "→" in locator
                or "@" in locator
            ):
                continue
            candidate_rule = _rule(
                observation.field_name,
                40,
                "stable_dom",
                kind="css",
                selector=locator,
            )
            if candidate_rule not in candidates.setdefault(observation.field_name, []):
                candidates[observation.field_name].append(candidate_rule)

    required = math.ceil(len(pages) * 0.8)
    combined_html = "\n".join(page["html"] for page in pages)
    mapping: dict[str, Any] = {}
    diagnostics: dict[str, Any] = {}
    for field_name in ALL_FIELDS:
        accepted: list[dict[str, Any]] = []
        attempts: list[dict[str, Any]] = []
        for candidate_rule in candidates.get(field_name, []):
            if candidate_rule.get("kind") == "json":
                leaf = str(candidate_rule.get("path", "")).split(".")[-1]
                if f'"{leaf}"' not in combined_html:
                    continue
            if candidate_rule.get("origin") == "metadata":
                selector = str(candidate_rule.get("selector", ""))
                marker = selector.split('="')[-1].split('"]')[0]
                if marker not in combined_html:
                    continue
            observer = ApprovedProfileObserver({field_name: candidate_rule}, _single_variant=True)
            matched: list[int] = []
            missing: list[int] = []
            ambiguous: list[int] = []
            for page in pages:
                values = {
                    json.dumps(item.normalized_value, ensure_ascii=False, sort_keys=True)
                    for item in observer.observe(page["final_url"], page["html"])
                    if item.field_name == field_name
                    and plausible_profile_value(field_name, item.normalized_value)
                }
                if len(values) == 1:
                    matched.append(page["id"])
                elif values:
                    ambiguous.append(page["id"])
                else:
                    missing.append(page["id"])
            passed = len(matched) >= required and not ambiguous
            report = {
                "status": "accepted" if passed else "rejected",
                "rule": candidate_rule,
                "matched_page_ids": matched,
                "missing_page_ids": missing,
                "ambiguous_page_ids": ambiguous,
                "coverage": len(matched) / len(pages) if pages else 0.0,
            }
            attempts.append(report)
            if passed:
                accepted.append({**candidate_rule, "training_coverage": report["coverage"]})
        if accepted:
            accepted.sort(key=lambda item: (item["priority"], -item["training_coverage"]))
            mapping[field_name] = {"variants": accepted}
        diagnostics[field_name] = {
            "status": "accepted" if accepted else "rejected",
            "attempts": attempts,
            "reason": (
                f"At least one ordered variant resolved {required} of {len(pages)} training pages"
                if accepted
                else f"No variant resolved {required} of {len(pages)} training pages"
            ),
        }
    return mapping, diagnostics


def _matches_rule_label(label: str, aliases: list[Any]) -> bool:
    normalized = normalize_text(label).casefold().strip(" :：-()")
    return any(
        normalized == normalize_text(alias).casefold().strip(" :：-()")
        for alias in aliases
        if isinstance(alias, str)
    )


def _json_path_values(payload: Any, path: str) -> list[Any]:
    """Evaluate allowlisted dotted JSON paths with optional numeric indexes."""
    if not re.fullmatch(r"\$(?:\.[A-Za-z0-9_@-]+|\[\d+\])+", path):
        return []
    values = [payload]
    tokens = re.findall(r"\.([A-Za-z0-9_@-]+)|\[(\d+)\]", path[1:])
    for key, raw_index in tokens:
        next_values: list[Any] = []
        if raw_index:
            index = int(raw_index)
            next_values.extend(
                value[index] for value in values if isinstance(value, list) and index < len(value)
            )
        else:
            next_values.extend(
                value[key] for value in values if isinstance(value, dict) and key in value
            )
        values = next_values
    return values


def resolve_candidates(observations: list[FieldCandidate]) -> Resolution:
    grouped: dict[str, list[FieldCandidate]] = {}
    for item in observations:
        if item.field_name in ALL_FIELDS and item.normalized_value not in (None, ""):
            grouped.setdefault(item.field_name, []).append(item)
    values: dict[str, Any] = {field_name: "unknown" for field_name in FEATURE_FIELDS}
    accepted: dict[str, FieldCandidate] = {}
    conflicts: dict[str, list[Any]] = {}
    source_claims = {
        field_name: [item.raw_value for item in items] for field_name, items in grouped.items()
    }
    for field_name, items in grouped.items():
        variants: dict[str, list[FieldCandidate]] = {}
        for item in items:
            key = json.dumps(item.normalized_value, ensure_ascii=False, sort_keys=True)
            variants.setdefault(key, []).append(item)
        acceptable: dict[str, list[FieldCandidate]] = {}
        for votes in variants.values():
            if max(v.confidence for v in votes) < 0.55:
                continue
            observers = {
                vote.observer_name for vote in votes if not vote.observer_name.startswith("llm")
            }
            high_trust = any(
                v.observer_name in {"structured_data", "approved_profile", "location_catalog"}
                and v.confidence >= 0.85
                for v in votes
            )
            if (
                high_trust
                or len(observers) >= 2
                or (field_name not in CORE_FIELDS and max(v.confidence for v in votes) >= 0.7)
            ):
                key = json.dumps(votes[0].normalized_value, ensure_ascii=False, sort_keys=True)
                acceptable[key] = votes
        if field_name in CORE_FIELDS and len(acceptable) > 1:
            conflicts[field_name] = [votes[0].normalized_value for votes in acceptable.values()]
            continue
        winner: FieldCandidate | None = None
        for votes in acceptable.values():
            proposed = max(votes, key=lambda value: value.confidence)
            if winner is None or proposed.confidence > winner.confidence:
                winner = proposed
        if winner:
            values[field_name] = winner.normalized_value
            accepted[field_name] = winner
    required = list(CORE_FIELDS)
    if values.get("property_type") in {"office", "shop", "warehouse", "workshop"}:
        required.remove("bedroom_count")
    unresolved = [name for name in required if name not in values]
    both_terms_are_zero = (
        isinstance(values.get("deposit_rial"), int)
        and isinstance(values.get("monthly_rent_rial"), int)
        and values["deposit_rial"] <= 0
        and values["monthly_rent_rial"] <= 0
    )
    if both_terms_are_zero:
        for name in ("deposit_rial", "monthly_rent_rial"):
            if name not in unresolved:
                unresolved.append(name)
    status = "accepted" if not conflicts and not unresolved else "needs_review"
    return Resolution(values, accepted, conflicts, unresolved, status, source_claims)


def _deduplicate(items: list[FieldCandidate]) -> list[FieldCandidate]:
    output: list[FieldCandidate] = []
    seen: set[tuple[str, str, str]] = set()
    for item in items:
        key = (
            item.field_name,
            json.dumps(item.normalized_value, ensure_ascii=False, sort_keys=True),
            item.source_locator,
        )
        if key not in seen:
            seen.add(key)
            output.append(item)
    return output


def normalize_url_shape(url: str) -> str:
    parts = urlsplit(url)
    segments = [unquote(segment) for segment in parts.path.split("/") if segment]
    shaped: list[str] = []
    for index, segment in enumerate(segments):
        stem, dot, extension = segment.rpartition(".")
        if not dot or len(extension) > 8:
            stem, dot, extension = segment, "", ""
        suffix = f".{extension.casefold()}" if dot else ""
        is_leaf = index == len(segments) - 1
        if re.fullmatch(r"\d{3,}", stem):
            value = "{id}"
        elif re.fullmatch(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
            stem,
            re.IGNORECASE,
        ):
            value = "{uuid}"
        elif re.fullmatch(r"[A-Za-z0-9_-]{16,}", stem) and any(char.isdigit() for char in stem):
            value = "{token}"
        elif (
            is_leaf
            and (
                re.search(r"(?:^|[-_])\d{3,}$", stem)
                or len(stem) >= 32
                or sum(char in "-_" for char in stem) >= 3
            )
            or index == len(segments) - 2
            and len(segments) >= 3
        ):
            value = "{slug}"
        else:
            value = stem.casefold()
        shaped.append(value + suffix)
    path = "/" + "/".join(shaped)
    return urlunsplit((parts.scheme.casefold(), parts.netloc.casefold(), path, "", ""))


def dom_fingerprint(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    tokens: list[str] = []
    for tag in soup.find_all(True)[:2500]:
        raw_classes = tag.get("class")
        classes = (
            sorted(
                str(name)
                for name in raw_classes
                if not re.search(r"\d{4,}|[a-f0-9]{8,}", str(name).casefold())
            )
            if isinstance(raw_classes, list)
            else []
        )
        role = tag.get("role", "")
        tokens.append(f"{tag.name}:{'.'.join(classes[:5])}:{role}")
    weights = [0] * 64
    for token, count in Counter(tokens).items():
        token_hash = int.from_bytes(hashlib.blake2b(token.encode(), digest_size=8).digest())
        for bit in range(64):
            weights[bit] += count if token_hash & (1 << bit) else -count
    value = sum(1 << bit for bit, weight in enumerate(weights) if weight >= 0)
    return f"{value:016x}"


def fingerprint_similarity(left: str, right: str) -> float:
    try:
        distance = (int(left, 16) ^ int(right, 16)).bit_count()
    except ValueError:
        return 0.0
    return 1 - (distance / 64)


def fingerprint_centroid(fingerprints: Iterable[str]) -> str:
    values = [int(value, 16) for value in fingerprints]
    if not values:
        raise ValueError("At least one fingerprint is required")
    weights = [sum(1 if value & (1 << bit) else -1 for value in values) for bit in range(64)]
    centroid = sum(1 << bit for bit, weight in enumerate(weights) if weight >= 0)
    return f"{centroid:016x}"


def looks_like_javascript_shell(html: str) -> bool:
    soup = BeautifulSoup(html, "html.parser")
    visible = normalize_text(soup.get_text(" ", strip=True))
    scripts = len(soup.find_all("script"))
    return (
        len(visible) < 160
        and scripts >= 1
        and bool(soup.select_one("#app, #root, #__next, #app-root"))
    )
