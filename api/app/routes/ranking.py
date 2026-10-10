from collections.abc import Callable

from app.contracts.models import RouteOption

UNKNOWN_SCALED = 1.0  # an unknown value ranks like the worst one


def scale(values: list[float | None]) -> list[float]:
    known = [value for value in values if value is not None]
    if not known:
        return [UNKNOWN_SCALED] * len(values)
    low, high = min(known), max(known)
    return [
        UNKNOWN_SCALED if value is None else (0.0 if high == low else (value - low) / (high - low)) for value in values
    ]


def add_label_to_best(options: list[RouteOption], label: str, value_of: Callable[[RouteOption], float | None]) -> None:
    known = [option for option in options if value_of(option) is not None]
    if known:
        min(known, key=value_of).labels.append(label)


def rank_options(options: list[RouteOption], preference: float, limit: int, heat_known: bool) -> list[RouteOption]:
    """score = p * heat + (1 - p) * (time + fare) / 2, each scaled 0..1 across the options. Lowest wins.
    While shade is still being prepared (heat_known False) some walks have no heat yet, so the options are ranked
    by time and fare only and none is called the coolest.
    Labels go on after the cut to `limit`, so every label points at an option the user can see."""
    if not heat_known:
        preference = 0.0
    durations = scale([option.duration_seconds for option in options])
    fares = scale([option.fare_inr for option in options])
    doses = scale([option.exposure.heat_dose for option in options])
    scores = [
        preference * dose + (1 - preference) * (0.5 * duration + 0.5 * fare)
        for duration, fare, dose in zip(durations, fares, doses, strict=True)
    ]
    ranked = [option for _, option in sorted(zip(scores, options, strict=True), key=lambda pair: pair[0])][:limit]
    ranked[0].labels.append("RECOMMENDED")
    add_label_to_best(ranked, "FASTEST", lambda option: option.duration_seconds)
    add_label_to_best(ranked, "CHEAPEST", lambda option: option.fare_inr)
    if heat_known:
        add_label_to_best(ranked, "COOLEST", lambda option: option.exposure.heat_dose)
    for number, option in enumerate(ranked, start=1):
        option.option_id = f"opt_{number}"
    return ranked
