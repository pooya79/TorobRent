RIAL_PER_TOMAN = 10


def rial_to_toman(amount_rial: int) -> int:
    return amount_rial // RIAL_PER_TOMAN


def toman_to_rial(amount_toman: int) -> int:
    return amount_toman * RIAL_PER_TOMAN
