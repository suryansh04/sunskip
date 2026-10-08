from datetime import datetime, time, timedelta

from app.conditions.report import start_of_hour
from app.config import IST, settings
from app.contracts.models import BestSlot, BestTimeRequest, BestTimeResponse, PlanRequest, RouteOption, Slot
from app.core.errors import ApiError
from app.core.formulas import dose_weight, round_half_up
from app.core.sun import sun_elevations
from app.routes.exposure import LineShade, line_sun, load_line_shade, to_exposure
from app.routes.plan import build_plan, trip_conditions

MAX_WINDOW = timedelta(hours=14)
FASTEST_FIRST = 0.0  # rank by time and fare only, so Google's own route (not our cooler copy) is re-timed
NOTE = "Bus times are not re-checked per slot."


def slot_times(request: BestTimeRequest) -> list[datetime]:
    start = datetime.combine(request.date, time.fromisoformat(request.from_), IST)
    end = datetime.combine(request.date, time.fromisoformat(request.to), IST)
    if end <= start or end - start > MAX_WINDOW:
        raise ApiError(400, "INVALID_REQUEST", "Pick a window that ends after it starts and is at most 14 hours")
    step = timedelta(minutes=request.step_minutes)
    count = int((end - start) / step) + 1
    return [start + index * step for index in range(count)]


async def walk_lines(option: RouteOption) -> list[tuple[datetime, LineShade]] | None:
    """Each walk leg's start and shade along its line, or None if any walk has no shade data."""
    month = option.depart_at.astimezone(IST).month
    lines = []
    for leg in option.legs:
        if leg.mode != "WALK":
            continue
        line = await load_line_shade(leg.polyline["coordinates"], month, settings.shade_sample_spacing_m)
        if not leg.shade_known or line is None:
            return None
        lines.append((leg.start_at, line))
    return lines


def shade_slots(option: RouteOption, lines: list, slots: list[datetime], feels_like: dict) -> list[Slot]:
    # Waiting stays the same minutes for every slot; it's counted in the hour of the first boarding
    first_boarding = next((leg.start_at for leg in option.legs if leg.wait_seconds is not None), None)
    wait_minutes = option.exposure.wait_sun_minutes or 0
    results = []
    for slot in slots:
        offset = slot - option.depart_at
        walks = [line_sun(line, start_at + offset, feels_like) for start_at, line in lines]
        waits = [(wait_minutes, first_boarding + offset)] if first_boarding else []
        exposure = to_exposure(walks, waits, feels_like)
        results.append(Slot(depart_at=slot, sun_minutes=exposure.sun_minutes, heat_dose=exposure.heat_dose))
    return results


def temperature_slots(option: RouteOption, slots: list[datetime], feels_like: dict) -> list[Slot]:
    """No shade data: rank by walking minutes x heat, only while the sun is up."""
    origin = option.legs[0].from_.location
    elevations = sun_elevations(origin.lat, origin.lng, slots)
    return [
        Slot(
            depart_at=slot,
            heat_dose=round_half_up(
                option.exposure.walk_minutes * dose_weight(feels_like.get(start_of_hour(slot)))
                if elevation >= settings.min_sun_elevation_deg
                else 0.0
            ),
        )
        for slot, elevation in zip(slots, elevations, strict=True)
    ]


def pick_best(slots: list[Slot], use_sun: bool) -> BestSlot | None:
    def value_of(slot: Slot) -> float | None:
        return slot.sun_minutes if use_sun else slot.heat_dose

    known = [slot for slot in slots if value_of(slot) is not None]
    return BestSlot(depart_at=min(known, key=value_of).depart_at) if known else None  # min keeps the earliest tie


async def find_best_time(request: BestTimeRequest, client_hash: str) -> BestTimeResponse:
    slots = slot_times(request)
    plan_request = PlanRequest(
        origin=request.origin,
        destination=request.destination,
        depart_at=slots[0],
        preference=FASTEST_FIRST,
        allow_erickshaw=False,
    )
    plan = await build_plan(plan_request, slots[0], client_hash)
    top = plan.options[0]
    _, feels_like = await trip_conditions(top.legs, slots[0])
    lines = await walk_lines(top)
    if lines is None:
        results = temperature_slots(top, slots, feels_like)
        return BestTimeResponse(
            basis="TEMPERATURE_ONLY", shade=plan.shade, slots=results, best=pick_best(results, False), note=NOTE
        )
    results = shade_slots(top, lines, slots, feels_like)
    return BestTimeResponse(basis="SHADE", shade=plan.shade, slots=results, best=pick_best(results, True), note=NOTE)
