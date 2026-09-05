import ipaddress
import re
from urllib.parse import urlsplit, urlunsplit

from django.core.exceptions import ValidationError


def normalize_public_url(url: str) -> str:
    """Syntactic checks only: DNS and network safety belong to the approved fetcher."""
    try:
        if any(ord(char) < 33 for char in url) or "\\" in url:
            raise ValueError
        parts = urlsplit(url)
        hostname = (parts.hostname or "").rstrip(".").encode("idna").decode("ascii").lower()
        if (
            parts.scheme not in {"http", "https"}
            or parts.username is not None
            or parts.password is not None
        ):
            raise ValueError
        if parts.port not in (None, 80 if parts.scheme == "http" else 443):
            raise ValueError
        if not hostname or "." not in hostname or len(hostname) > 253:
            raise ValueError
        if hostname.endswith((
            ".localhost",
            ".local",
            ".internal",
            ".lan",
            ".home",
            ".test",
            ".invalid",
        )):
            raise ValueError
        if not re.fullmatch(
            r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+",
            hostname,
        ):
            raise ValueError
        try:
            ipaddress.ip_address(hostname)
        except ValueError:
            if not re.search(r"[a-z]", hostname.rsplit(".", 1)[1]) or hostname.rsplit(".", 1)[
                1
            ].startswith("0x"):
                raise ValueError from None
        else:
            raise ValueError
        return urlunsplit((parts.scheme, hostname, parts.path or "/", parts.query, ""))
    except ValueError, UnicodeError:
        raise ValidationError(
            "نشانی عمومی معتبر با http یا https و بدون اطلاعات ورود وارد کنید."
        ) from None


def normalize_public_domain(url: str) -> str:
    return str(urlsplit(normalize_public_url(url)).hostname)
