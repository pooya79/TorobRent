from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

CHARACTER_TRANSLATION = str.maketrans({
    "ي": "ی",
    "ى": "ی",
    "ك": "ک",
    "ة": "ه",
    "ۀ": "ه",
    "ؤ": "و",
    "إ": "ا",
    "أ": "ا",
})
DIGIT_TRANSLATION = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
TRACKING_QUERY_KEYS = {"ref", "source", "utm_campaign", "utm_content", "utm_medium", "utm_source"}


@dataclass(frozen=True)
class NormalizedListing:
    title: str
    price_rial: int | None
    currency: str
    source_url: str

    def to_dict(self) -> dict[str, str | int | None]:
        return asdict(self)


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).translate(CHARACTER_TRANSLATION)
    return " ".join(normalized.split())


def normalize_price(value: str | int | None, currency: str = "IRR") -> int | None:
    if value is None or value == "":
        return None
    digits = re.sub(r"[^0-9]", "", str(value).translate(DIGIT_TRANSLATION))
    if not digits:
        return None
    amount = int(digits)
    if normalize_text(currency).casefold() in {"irt", "تومان", "تومن"}:
        amount *= 10
    return amount


def normalize_url(value: str) -> str:
    parts = urlsplit(value.strip())
    query = [
        (key, item)
        for key, item in parse_qsl(parts.query, keep_blank_values=True)
        if key.casefold() not in TRACKING_QUERY_KEYS
    ]
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((
        parts.scheme.casefold(),
        parts.netloc.casefold(),
        path,
        urlencode(query),
        "",
    ))


def normalize_listing(
    *, title: str, price: str | int | None, currency: str, source_url: str
) -> NormalizedListing:
    return NormalizedListing(
        title=normalize_text(title),
        price_rial=normalize_price(price, currency),
        currency="IRR",
        source_url=normalize_url(source_url),
    )
