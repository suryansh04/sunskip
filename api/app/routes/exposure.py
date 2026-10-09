from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np

from app.conditions.report import start_of_hour
from app.config import settings
from app.contracts.models import Exposure
from app.core.formulas import dose_weight, round_half_up, round_whole
from app.core.geo import Point, line_length_m, sample_line
from app.routes.walk import NO_SHADE_ROW, WalkPath, counted_sun
from app.shade.tiles import NO_DATA, SHADE, sun_bits

SECONDS_PER_MINUTE = 60


@dataclass
class WalkSun:
    length_m: float
    sun_by_hour: dict[datetime, float] | None  # minutes in sun per IST hour; None = unknown
    hot_sun_minutes: float
    peak_feels_like_c: float | None


def peak_feels_like(feels_like: dict, start_at: datetime, end_at: datetime) -> float | None:
    hour, last_hour = start_of_hour(start_at), start_of_hour(end_at)
    values = []
    while hour <= last_hour:
        if feels_like.get(hour) is not None:
            values.append(feels_like[hour])
        hour += timedelta(hours=1)
    return max(values, default=None)


def unknown_walk_sun(length_m: float, peak_feels_like_c: float | None) -> WalkSun:
    return WalkSun(length_m, None, 0.0, peak_feels_like_c)


@dataclass
class LineShade:
    points: list[Point]  # evenly spaced along the line
    bits: np.ndarray  # (points, 24): 1 sun, 0 shade, -1 no data
    piece_m: float  # line length each point stands for


async def load_line_shade(coords: list[Point], month: int, spacing_m: float) -> LineShade | None:
    """Sun or shade straight from the Solar files along any walking line; None if there's no data at all."""
    points = sample_line(coords, spacing_m)
    bits = await sun_bits(points, month)
    if (bits == NO_DATA).all():
        return None
    return LineShade(points, bits, line_length_m(coords) / len(points))


def sum_sun(
    lengths: list[float], sun_share_at: Callable[[int, int], float], start_at: datetime, feels_like: dict
) -> WalkSun:
    """Walks piece by piece; the clock (and so the hour) moves forward at walking speed."""
    walked_m, hot_minutes, peak = 0.0, 0.0, None
    sun_by_hour = defaultdict(float)
    for index, length in enumerate(lengths):
        hour = start_of_hour(start_at + timedelta(seconds=walked_m / settings.walk_speed_mps))
        minutes = length * sun_share_at(index, hour.hour) / settings.walk_speed_mps / SECONDS_PER_MINUTE
        sun_by_hour[hour] += minutes
        feels = feels_like.get(hour)
        if feels is not None:
            peak = feels if peak is None else max(peak, feels)
            hot_minutes += minutes if feels >= settings.heat_alert_feels_like_c else 0
        walked_m += length
    return WalkSun(sum(lengths), dict(sun_by_hour), hot_minutes, peak)


def walk_sun(path: WalkPath, start_at: datetime, feels_like: dict) -> WalkSun:
    def sun_share(index: int, hour: int) -> float:
        return counted_sun(path.sun.get((path.pieces[index][0], hour), NO_SHADE_ROW))

    return sum_sun([length for _, length in path.pieces], sun_share, start_at, feels_like)


def line_sun(line: LineShade, start_at: datetime, feels_like: dict) -> WalkSun:
    def sun_share(index: int, hour: int) -> float:
        return 0.0 if line.bits[index, hour] == SHADE else 1.0  # no data counts as sun

    return sum_sun([line.piece_m] * len(line.points), sun_share, start_at, feels_like)


def line_nodata_m(line: LineShade, start_at: datetime) -> float:
    return float((line.bits[:, start_of_hour(start_at).hour] == NO_DATA).sum()) * line.piece_m


def wait_sun_minutes(wait_seconds: int, stop_shaded: bool | None, stop_sun_fraction: float | None) -> float:
    if stop_shaded:
        return 0.0
    minutes = wait_seconds / SECONDS_PER_MINUTE
    if stop_sun_fraction is None:
        return minutes  # unknown stop: assume full sun
    return minutes * stop_sun_fraction


def to_exposure(walks: list[WalkSun], waits: list[tuple[float, datetime]] | None, feels_like: dict) -> Exposure:
    """One Exposure for a single walk leg (waits=None) or a whole option (its walks plus stop waits)."""
    length = sum(walk.length_m for walk in walks)
    peaks = [walk.peak_feels_like_c for walk in walks if walk.peak_feels_like_c is not None]
    wait_minutes = sum(minutes for minutes, _ in waits) if waits is not None else None
    exposure = Exposure(
        walk_meters=round_whole(length),
        walk_minutes=round_half_up(length / settings.walk_speed_mps / SECONDS_PER_MINUTE),
        wait_sun_minutes=round_half_up(wait_minutes),
        feels_like_c=max(peaks) if peaks else None,
    )
    if any(walk.sun_by_hour is None for walk in walks):
        return exposure
    buckets = defaultdict(float)
    for walk in walks:
        for hour, minutes in walk.sun_by_hour.items():
            buckets[hour] += minutes
    for minutes, moment in waits or []:
        buckets[start_of_hour(moment)] += minutes
    sun_minutes = sum(sum(walk.sun_by_hour.values()) for walk in walks)
    sun_m = sun_minutes * SECONDS_PER_MINUTE * settings.walk_speed_mps
    exposure.sun_minutes = round_half_up(sun_minutes)
    exposure.sun_minutes_hot = round_half_up(sum(walk.hot_sun_minutes for walk in walks))
    exposure.shade_pct = round_half_up(max(0.0, 100 * (1 - sun_m / length))) if length else None  # no -0.0
    exposure.heat_dose = round_half_up(
        sum(minutes * dose_weight(feels_like.get(hour)) for hour, minutes in buckets.items())
    )
    return exposure
