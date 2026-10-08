"""Reads Google Solar's hourly shade files we saved, for any list of points."""

import asyncio
from collections import defaultdict

import numpy as np
import rasterio
from pyproj import Transformer

from app.config import settings
from app.core.geo import Point, geohash_encode
from app.core.storage import local_path
from app.db.shade_queries import get_cell_statuses

HOURS = 24
CELL_PRECISION = 7
NO_DATA = -1
SUN = 1


def cell_of(point: Point) -> str:
    return geohash_encode(point[1], point[0], CELL_PRECISION)


def group_by_cell(points: list[Point]) -> dict[str, list[int]]:
    cells_of_points = defaultdict(list)
    for index, point in enumerate(points):
        cells_of_points[cell_of(point)].append(index)
    return cells_of_points


def read_sun_bits(geohash: str, month: int, points: list[Point]) -> np.ndarray:
    """(len(points), 24) of 1 = sun, 0 = shade, -1 = no data, for the representative day."""
    with rasterio.open(local_path(f"shade/{geohash}/month_{month:02d}.tif")) as tile:
        to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True)
        xs, ys = to_tile.transform([point[0] for point in points], [point[1] for point in points])
        values = np.ma.array(list(tile.sample(zip(xs, ys, strict=True), masked=True)))
    # Careful: in Solar's data a set bit means SUN. Bit (day - 1) is that day of the month
    sun = ((values.astype(np.uint32) >> (settings.representative_day - 1)) & 1).astype(np.int8)
    return np.where(np.ma.getmaskarray(values), NO_DATA, sun).astype(np.int8)


def month_bits(points: list[Point], cells_of_points: dict[str, list[int]], statuses: dict, month: int) -> np.ndarray:
    bits = np.full((len(points), HOURS), NO_DATA, dtype=np.int8)
    for geohash, indexes in cells_of_points.items():
        if statuses.get(geohash) == "READY":
            bits[indexes] = read_sun_bits(geohash, month, [points[index] for index in indexes])
    return bits


async def sun_bits(points: list[Point], month: int) -> np.ndarray:
    """Sun (1), shade (0) or no data (-1) for each point and IST hour, for the month's representative day."""
    cells_of_points = group_by_cell(points)
    statuses = await get_cell_statuses(list(cells_of_points))
    return await asyncio.to_thread(month_bits, points, cells_of_points, statuses, month)
