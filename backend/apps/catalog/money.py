RIAL_PER_TOMAN = 10
PERSIAN_AND_ARABIC_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def rial_to_toman(amount_rial: int) -> int:
    return amount_rial // RIAL_PER_TOMAN


def toman_to_rial(amount_toman: int) -> int:
    return amount_toman * RIAL_PER_TOMAN


def parse_localized_integer(value: str) -> int:
    normalized = (
        value.translate(PERSIAN_AND_ARABIC_DIGITS).replace(",", "").replace("٬", "").strip()
    )
    if not normalized.isdecimal():
        raise ValueError("Expected a non-negative integer")
    return int(normalized)
