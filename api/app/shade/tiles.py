"""Reads Google Solar's hourly shade files we saved, for any list of points."""

import asyncio
import logging
from collections import defaultdict
from functools import cache, lru_cache

import numpy as np
import rasterio
from affine import Affine
from pyproj import Transformer

from app.config import settings
from app.core.geo import Point, geohash_encode
from app.core.storage import local_path
from app.db.shade_queries import get_cell_statuses

HOURS = 24
CELL_PRECISION = 7
NO_DATA = -1
SHADE = 0
SUN = 1

# Google's files carry a harmless odd TIFF tag; GDAL warns about it on every open
logging.getLogger("rasterio._env").setLevel(logging.ERROR)


def cell_of(point: Point) -> str:
    return geohash_encode(point[1], point[0], CELL_PRECISION)


def group_by_cell(points: list[Point]) -> dict[str, list[int]]:
    cells_of_points = defaultdict(list)
    for index, point in enumerate(points):
        cells_of_points[cell_of(point)].append(index)
    return cells_of_points


@cache
def transformer_to(crs: str) -> Transformer:
    return Transformer.from_crs("EPSG:4326", crs, always_xy=True)


# Each decoded tile is ~5 MB. One long trip touches ~60 tiles, so a small cache would re-read them on every plan
@lru_cache(maxsize=settings.shade_tiles_cached)
def load_tile(geohash: str, month: int) -> tuple[np.ndarray, np.ndarray, Affine, str]:
    """(values, no-data mask, transform, crs) of one saved month file. Saved files never change, so caching is safe;
    decoding is the slow part (~25 ms), and neighbouring requests keep asking for the same tiles."""
    with rasterio.open(local_path(f"shade/{geohash}/month_{month:02d}.tif")) as tile:
        bands = tile.read(masked=True)  # all 24 hours at once; far faster than sampling point by point
        return bands.data, np.ma.getmaskarray(bands), tile.transform, tile.crs.to_string()


def read_sun_bits(geohash: str, month: int, points: list[Point]) -> np.ndarray:
    """(len(points), 24) of 1 = sun, 0 = shade, -1 = no data, for the representative day."""
    data, mask, transform, crs = load_tile(geohash, month)
    xs, ys = transformer_to(crs).transform([point[0] for point in points], [point[1] for point in points])
    rows, cols = (np.asarray(index) for index in rasterio.transform.rowcol(transform, xs, ys))
    inside = (rows >= 0) & (rows < data.shape[1]) & (cols >= 0) & (cols < data.shape[2])
    values = np.zeros((len(points), HOURS), dtype=np.uint32)
    missing = np.ones((len(points), HOURS), dtype=bool)
    values[inside] = data[:, rows[inside], cols[inside]].T
    missing[inside] = mask[:, rows[inside], cols[inside]].T
    # Careful: in Solar's data a set bit means SUN. Bit (day - 1) is that day of the month
    sun = ((values >> (settings.representative_day - 1)) & 1).astype(np.int8)
    return np.where(missing, NO_DATA, sun).astype(np.int8)


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
