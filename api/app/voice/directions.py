"""Spoken walking directions from a trip's waypoints (api.md endpoint 10): one step per straight run, said where
the run starts, e.g. "Head south along GHS footpath for 50 m. This part is in sun. Then turn right."."""

import asyncio
from dataclasses import dataclass
from uuid import UUID

from app.config import settings
from app.contracts.models import VoiceStep, Waypoint
from app.routes.waypoints import compass, trip_waypoints
from app.voice.audio import speak

SHORT_STEP_M = 5  # distances under 100 m are said to the nearest 5 m
LONG_STEP_M = 10
LONG_FROM_M = 100


@dataclass
class Run:
    start: int  # waypoint index where the run starts (its cue is said there)
    end: int  # waypoint index where it ends


def said_metres(metres: float) -> int:
    step = LONG_STEP_M if metres >= LONG_FROM_M else SHORT_STEP_M
    return max(step, round(metres / step) * step)


def runs_of(points: list[Waypoint]) -> list[Run]:
    """Cut the walk wherever a waypoint has a cue (a walk's start, or a turn)."""
    starts = [index for index, point in enumerate(points) if point.cue]
    runs = []
    for start, next_start in zip(starts, [*starts[1:], len(points)], strict=True):
        # A run stops at its walk's last point: the next walk starts after a ride
        same_walk = next_start < len(points) and points[next_start].leg_index == points[start].leg_index
        end = next_start if same_walk else next_start - 1
        if end > start:
            runs.append(Run(start, end))
    return runs


def shade_note(points: list[Waypoint], run: Run) -> str:
    """What the sun is like along the run: each waypoint stands for the piece up to the next one."""
    sun_m = shade_m = 0.0
    for index in range(run.start, run.end):
        piece_m = points[index + 1].distance_from_start_m - points[index].distance_from_start_m
        if points[index].in_sun is True:
            sun_m += piece_m
        elif points[index].in_sun is False:
            shade_m += piece_m
    if not sun_m and not shade_m:
        return ""
    if not shade_m:
        return " This part is in sun."
    if not sun_m:
        return " This part is shaded."
    return f" {said_metres(sun_m)} m of it is in sun."


def what_next(points: list[Waypoint], run: Run) -> str:
    end = points[run.end]
    if run.end == len(points) - 1:
        return "Then you arrive."
    if points[run.end + 1].leg_index != end.leg_index:
        return "Then you reach your stop."  # a ride comes before the next walk
    return f"Then {end.cue[0].lower()}{end.cue[1:]}." if end.cue else ""


def step_text(points: list[Waypoint], run: Run) -> str:
    start, end = points[run.start], points[run.end]
    metres = said_metres(end.distance_from_start_m - start.distance_from_start_m)
    cue = start.cue if start.cue.startswith("Head") else f"{start.cue} and head {compass(start.bearing_deg)}"
    return f"{cue} for {metres} m.{shade_note(points, run)} {what_next(points, run)}".strip()


def direction_steps(points: list[Waypoint], max_steps: int) -> list[tuple[float, str]]:
    """(metres from the start where it is said, English text), in walking order."""
    steps = [(points[run.start].distance_from_start_m, step_text(points, run)) for run in runs_of(points)]
    if points:
        steps.append((points[-1].distance_from_start_m, "You have arrived."))
    return steps[:max_steps]


async def spoken_directions(trip_id: UUID, option_id: str, language: str) -> list[VoiceStep]:
    """Every step of the walk, translated and spoken (a few at a time). A step whose voice fails keeps its text."""
    waypoints = (await trip_waypoints(trip_id, option_id, None)).waypoints
    steps = direction_steps(waypoints, settings.voice_max_steps)
    limit = asyncio.Semaphore(settings.voice_parallel_calls)

    async def say(index: int, at_m: float, text: str) -> VoiceStep:
        async with limit:
            spoken = await speak(text, language, from_english=True)
        return VoiceStep(index=index, trigger_at_meters=at_m, text=spoken.text, audio_url=spoken.audio_url)

    return list(await asyncio.gather(*(say(index, at_m, text) for index, (at_m, text) in enumerate(steps))))
