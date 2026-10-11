"""Short plain-text summaries of SunSkip's own answers, for Claude to read and the number check to compare against.
Times are written like "5 PM", the way people say them, so a reply's numbers can be found here."""

from datetime import datetime

from app.config import IST
from app.contracts.models import BestTimeResponse, Conditions, Leg, PlanResponse, RouteOption

MODE_WORDS = {"WALK": "walk", "BUS": "bus", "METRO": "metro", "RAIL": "train", "ERICKSHAW": "e-rickshaw"}
NOON = 12
OPTIONS_SHOWN = 3
SECONDS_PER_MINUTE = 60


def clock(moment: datetime) -> str:
    local = moment.astimezone(IST)
    hour = local.hour % NOON or NOON
    half = "AM" if local.hour < NOON else "PM"
    return f"{hour} {half}" if local.minute == 0 else f"{hour}:{local.minute:02d} {half}"


def whole_minutes(seconds: int) -> int:
    return round(seconds / SECONDS_PER_MINUTE)


def minutes(value: float | None, what: str) -> str:
    return f"{what} unknown" if value is None else f"{value} min {what}"


def leg_words(leg: Leg) -> str:
    if leg.line and leg.line.short_name:
        return f"{MODE_WORDS[leg.mode]} {leg.line.short_name}"
    return MODE_WORDS[leg.mode]


def option_line(option: RouteOption) -> str:
    labels = f" ({', '.join(label.lower() for label in option.labels)})" if option.labels else ""
    fare = "fare unknown" if option.fare_inr is None else f"fare ₹{option.fare_inr}"
    exposure = option.exposure
    return (
        f"Option {option.option_id}{labels}: {', '.join(leg_words(leg) for leg in option.legs)}; "
        f"leave {clock(option.depart_at)}, arrive {clock(option.arrive_at)}, "
        f"{whole_minutes(option.duration_seconds)} min; "
        f"{fare}; {exposure.walk_meters} m on foot; {minutes(exposure.sun_minutes, 'walking in direct sun')}; "
        f"{minutes(exposure.wait_sun_minutes, 'waiting in sun at stops')}."
    )


def shade_words(plan: PlanResponse) -> str:
    if plan.shade.status == "PREPARING":
        return "Shade data for this area is still being prepared, so some walking sun minutes are unknown for now."
    if plan.shade.status == "UNAVAILABLE":
        return "There is no shade data for this area, so walking sun minutes are unknown."
    return ""


def plan_facts(plan: PlanResponse) -> str:
    heat = plan.conditions.feels_like_c
    weather = "" if heat is None else f"Feels like {heat} C{' (heat alert)' if plan.conditions.heat_alert else ''}. "
    lines = [option_line(option) for option in plan.options[:OPTIONS_SHOWN]]
    return f"{weather}{shade_words(plan)}\n" + "\n".join(lines)


def plan_summary(plan: PlanResponse) -> str:
    """One sentence a person can rely on when the agent's own reply can't be used."""
    top = plan.options[0]
    route = ", then ".join(leg_words(leg) for leg in top.legs)
    sun = top.exposure.sun_minutes
    sun_words = "minutes in sun unknown" if sun is None else f"{sun} min walking in direct sun"
    return f"Best match: {route}, {whole_minutes(top.duration_seconds)} min, {sun_words}."


def best_time_facts(answer: BestTimeResponse) -> str:
    estimate = answer.basis == "TEMPERATURE_ONLY"
    slots = "; ".join(
        f"{clock(slot.depart_at)}: "
        + (f"heat score {slot.heat_dose} (estimate)" if estimate else minutes(slot.sun_minutes, "walking in sun"))
        for slot in answer.slots
    )
    best = f" Best time to leave: {clock(answer.best.depart_at)}." if answer.best else ""
    basis = " No shade data here, so hours are compared by sun angle and temperature only." if estimate else ""
    return f"Leaving at each hour today:{basis} {slots}.{best} {answer.note}"


def best_time_summary(answer: BestTimeResponse) -> str:
    if not answer.best:
        return "Minutes in sun are unknown for this trip, so the hours can't be compared."
    best = next(slot for slot in answer.slots if slot.depart_at == answer.best.depart_at)
    if best.sun_minutes is None:
        return f"{clock(best.depart_at)} looks coolest (estimate from the sun and temperature)."
    return f"Leaving at {clock(best.depart_at)} has the least sun: {best.sun_minutes} min walking in direct sun."


def conditions_facts(conditions: Conditions) -> str:
    air = "" if conditions.naqi is None else f" Air quality (NAQI) {conditions.naqi}, {conditions.naqi_category}."
    later = "; ".join(f"{clock(hour.at)} feels like {hour.feels_like_c} C" for hour in conditions.hourly[1:7])
    alert = " Heat alert (feels like 40 C or more)." if conditions.heat_alert else " No heat alert (below 40 C)."
    return (
        f"At {clock(conditions.at)}: {conditions.temp_c} C, feels like {conditions.feels_like_c} C.{alert}{air} "
        f"Next hours: {later}."
    )


def conditions_summary(conditions: Conditions) -> str:
    alert = " Heat alert." if conditions.heat_alert else ""
    return f"It feels like {conditions.feels_like_c} C now.{alert}"


def leg_facts(option: RouteOption, number: int) -> str:
    leg = option.legs[number - 1]
    start, end = leg.from_.name or "the start", leg.to.name or "the end"
    words = (
        f"Leg {number} of option {option.option_id}: {leg_words(leg)} from {start} to {end}, {leg.distance_meters} m"
    )
    if leg.mode == "WALK" and leg.exposure:
        shade = "shade unknown" if leg.exposure.shade_pct is None else f"{leg.exposure.shade_pct}% in shade"
        return f"{words}; {minutes(leg.exposure.sun_minutes, 'in direct sun')}; {shade}."
    if leg.wait_seconds is not None:
        stop = {True: "has shade", False: "has no shade", None: "shade unknown"}[leg.stop_shaded]
        return f"{words}; wait about {whole_minutes(leg.wait_seconds)} min at the stop, which {stop}."
    return f"{words}."
