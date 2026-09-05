from __future__ import annotations

import re
import unicodedata
from typing import Any
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
SPACE_RE = re.compile(r"[\s\u200c\u200f]+")
ARABIC_DIACRITICS_RE = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")


def normalize_text(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", str(value)).translate(CHARACTER_TRANSLATION)
    without_diacritics = ARABIC_DIACRITICS_RE.sub("", normalized)
    return SPACE_RE.sub(" ", without_diacritics).strip()


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
