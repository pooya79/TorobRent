from decimal import ROUND_HALF_UP, Decimal, localcontext

CALCULATION_VERSION = "1"
MONTHLY_RATE_PRECISION = Decimal("0.000000000000000001")


def monthly_opportunity_rate(annual_return_rate_percent: Decimal) -> Decimal:
    with localcontext() as context:
        context.prec = 40
        annual_rate = annual_return_rate_percent / Decimal(100)
        monthly_rate = ((Decimal(1) + annual_rate).ln() / Decimal(12)).exp() - Decimal(1)
    return monthly_rate.quantize(MONTHLY_RATE_PRECISION, rounding=ROUND_HALF_UP)


def rounded_rial(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def rounded_toman(value_rial: Decimal) -> int:
    return int((value_rial / Decimal(10)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
