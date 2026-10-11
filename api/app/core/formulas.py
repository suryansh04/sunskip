from decimal import ROUND_HALF_UP, Decimal

COMFORT_LIMIT_C = 30
HOT_LIMIT_C = 40
WARM_RANGE_C = 10
HOT_STEP_C = 5
MIN_DOSE_WEIGHT = 0.1
FLOAT_NOISE_PLACES = 9
NOON = 12


def round_half_up(value: float | None, places: int = 1) -> float | None:
    if value is None:
        return None
    # Round off float noise first, so 11.2499999999 still counts as 11.25
    cleaned = Decimal(str(round(value, FLOAT_NOISE_PLACES)))
    return float(cleaned.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def heat_weight(feels_like_c: float | None) -> float:
    if feels_like_c is None:
        return 1.0
    if feels_like_c < COMFORT_LIMIT_C:
        return 0.0
    if feels_like_c < HOT_LIMIT_C:
        return (feels_like_c - COMFORT_LIMIT_C) / WARM_RANGE_C
    return 1 + (feels_like_c - HOT_LIMIT_C) / HOT_STEP_C


def dose_weight(feels_like_c: float | None) -> float:
    return max(heat_weight(feels_like_c), MIN_DOSE_WEIGHT)


def hour_label(hour: int) -> str:
    """13 -> "1 PM", the way people say it."""
    return f"{hour % NOON or NOON} {'AM' if hour < NOON else 'PM'}"


def round_whole(value: float | None) -> int | None:
    """Half-up rounding to a whole number, as an int (metres, walkers, scores)."""
    rounded = round_half_up(value, 0)
    return None if rounded is None else int(rounded)
