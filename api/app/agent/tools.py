"""The agent's four tools (api.md endpoint 9). Each runs the same logic as an endpoint and answers in plain text."""

from dataclasses import dataclass, field
from datetime import datetime, time
from uuid import UUID

from app.agent.facts import (
    best_time_facts,
    best_time_summary,
    conditions_facts,
    conditions_summary,
    leg_facts,
    plan_facts,
    plan_summary,
)
from app.conditions.report import get_conditions
from app.config import IST
from app.contracts.models import BestTimeRequest, LatLng, PlaceInput, PlanRequest
from app.core.errors import ApiError
from app.routes.best_time import find_best_time
from app.routes.places import search_places
from app.routes.plan import plan_trip
from app.routes.waypoints import load_option

PREFERENCE = 0.7  # the app's own setting: lean towards less sun
DAY_FROM, DAY_TO = "07:00", "19:00"
HOURLY = 60

PLACE_FIELD = {"type": "string", "description": "A place name, e.g. 'Mansarovar Metro Station' or 'G3 block'"}
TOOLS = [
    {
        "name": "plan_route",
        "description": "Plans a trip and returns the best options with time, fare, minutes walking in direct sun "
        "and minutes waiting in sun. Use it for 'how do I get to', 'which route has the least sun'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "destination": PLACE_FIELD,
                "origin": {**PLACE_FIELD, "description": "Where from; leave out to start where the user is"},
                "leave_at": {"type": "string", "description": "Leave time today, 24-hour HH:MM; leave out for now"},
            },
            "required": ["destination"],
        },
    },
    {
        "name": "find_best_time",
        "description": "Minutes walking in direct sun for leaving at each hour today (7 AM to 7 PM), and the best "
        "hour. Use it for 'when should I leave', 'is it better at 5'.",
        "input_schema": {
            "type": "object",
            "properties": {"destination": PLACE_FIELD, "origin": PLACE_FIELD},
            "required": ["destination"],
        },
    },
    {
        "name": "get_conditions",
        "description": "Temperature, feels-like temperature, heat alert and air quality (NAQI) where the user is, "
        "now and for the next hours.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "explain_segment",
        "description": "Details of one leg of the current trip: for a walk, its minutes in direct sun and shade; "
        "for a ride, the wait at the stop and whether the stop has shade.",
        "input_schema": {
            "type": "object",
            "properties": {
                "option_id": {"type": "string", "description": "e.g. opt_1"},
                "leg_number": {"type": "integer", "description": "1 for the first leg"},
            },
            "required": ["option_id", "leg_number"],
        },
    },
]


@dataclass
class ToolContext:
    client_hash: str
    location: LatLng | None
    trip_id: UUID | None
    summaries: list[str] = field(default_factory=list)  # one sentence per answer, for the template reply


async def place_input(name: str | None, context: ToolContext) -> PlaceInput:
    """A named place near the user from OSM when there is one (Google often places campus names far away),
    else the name for Google to look up. No name means where the user is."""
    if not name:
        if context.location is None:
            raise ApiError(400, "INVALID_REQUEST", "Where the user is isn't known; ask where they start from")
        return PlaceInput(lat=context.location.lat, lng=context.location.lng)
    if context.location:
        found = await search_places(name, context.location.lat, context.location.lng)
        if found.places:
            return PlaceInput(lat=found.places[0].location.lat, lng=found.places[0].location.lng)
    return PlaceInput(query=name)


def leave_time(text: str | None) -> datetime:
    now = datetime.now(IST)
    if not text:
        return now
    try:
        return datetime.combine(now.date(), time.fromisoformat(text), IST)
    except ValueError as error:
        raise ApiError(400, "INVALID_REQUEST", "leave_at must be HH:MM") from error


async def plan_route(tool_input: dict, context: ToolContext) -> str:
    request = PlanRequest(
        origin=await place_input(tool_input.get("origin"), context),
        destination=await place_input(tool_input["destination"], context),
        depart_at=leave_time(tool_input.get("leave_at")),
        preference=PREFERENCE,
    )
    plan = await plan_trip(request, context.client_hash)
    context.trip_id = UUID(plan.trip_id)  # later questions about legs are about this trip
    context.summaries.append(plan_summary(plan))
    return plan_facts(plan)


async def best_time(tool_input: dict, context: ToolContext) -> str:
    request = BestTimeRequest(
        origin=await place_input(tool_input.get("origin"), context),
        destination=await place_input(tool_input["destination"], context),
        date=datetime.now(IST).date(),
        from_=DAY_FROM,
        to=DAY_TO,
        step_minutes=HOURLY,
    )
    answer = await find_best_time(request, context.client_hash)
    context.summaries.append(best_time_summary(answer))
    return best_time_facts(answer)


async def conditions_here(tool_input: dict, context: ToolContext) -> str:
    if context.location is None:
        raise ApiError(400, "INVALID_REQUEST", "Where the user is isn't known")
    conditions = await get_conditions(context.location, datetime.now(IST).replace(second=0, microsecond=0))
    context.summaries.append(conditions_summary(conditions))
    return conditions_facts(conditions)


async def explain_segment(tool_input: dict, context: ToolContext) -> str:
    if context.trip_id is None:
        raise ApiError(400, "INVALID_REQUEST", "There is no trip yet; plan one first")
    option = await load_option(context.trip_id, tool_input["option_id"])
    number = int(tool_input["leg_number"])
    if not 1 <= number <= len(option.legs):
        raise ApiError(400, "INVALID_REQUEST", f"This option has {len(option.legs)} legs")
    facts = leg_facts(option, number)
    context.summaries.append(facts)
    return facts


RUNNERS = {
    "plan_route": plan_route,
    "find_best_time": best_time,
    "get_conditions": conditions_here,
    "explain_segment": explain_segment,
}


async def run_tool(name: str, tool_input: dict, context: ToolContext) -> tuple[str, bool]:
    """(what to tell Claude, whether it failed). A failure is told to Claude plainly so it can ask or explain."""
    try:
        return await RUNNERS[name](tool_input, context), False
    except ApiError as error:
        return f"Could not answer: {error.message}", True
    except (KeyError, ValueError):
        return "Could not answer: a place or time in the question wasn't clear", True
