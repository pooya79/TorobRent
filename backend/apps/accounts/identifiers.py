from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from django.core.exceptions import ValidationError
from django.core.validators import validate_email

PERSIAN_AND_ARABIC_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
PHONE_SEPARATORS = re.compile(r"[\s\-()]")


@dataclass(frozen=True)
class AccountIdentifier:
    kind: Literal["email", "phone"]
    value: str


def normalize_iranian_mobile(value: str) -> str | None:
    digits = PHONE_SEPARATORS.sub("", value.translate(PERSIAN_AND_ARABIC_DIGITS))
    if digits.startswith("0098"):
        digits = "0" + digits[4:]
    elif digits.startswith("+98"):
        digits = "0" + digits[3:]
    elif digits.startswith("98"):
        digits = "0" + digits[2:]
    if re.fullmatch(r"09\d{9}", digits) is None:
        return None
    return digits


def normalize_account_identifier(value: str) -> AccountIdentifier:
    value = value.strip()
    phone = normalize_iranian_mobile(value)
    if phone is not None:
        return AccountIdentifier("phone", phone)
    email = value.lower()
    try:
        validate_email(email)
    except ValidationError as error:
        raise ValueError("identifier is neither an email nor an Iranian mobile number") from error
    return AccountIdentifier("email", email)
