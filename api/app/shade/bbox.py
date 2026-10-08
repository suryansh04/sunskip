from app.core.errors import ApiError
from app.core.geo import haversine_m

SQUARE_METERS_PER_KM2 = 1_000_000
MAX_LNG, MAX_LAT = 180, 90

BBox = tuple[float, float, float, float]  # west, south, east, north


def is_real_box(west: float, south: float, east: float, north: float) -> bool:
    """Ordered corners on the globe; also false for nan, which fails every comparison."""
    return -MAX_LNG <= west < east <= MAX_LNG and -MAX_LAT <= south < north <= MAX_LAT


def parse_bbox(bbox: str, max_km2: float) -> BBox:
    try:
        west, south, east, north = (float(value) for value in bbox.split(","))
    except ValueError as error:
        raise ApiError(400, "INVALID_REQUEST", "bbox must be west,south,east,north") from error
    if not is_real_box(west, south, east, north):
        raise ApiError(400, "INVALID_REQUEST", "bbox must be west,south,east,north in degrees")
    area_km2 = haversine_m((west, south), (east, south)) * haversine_m((west, south), (west, north))
    if area_km2 / SQUARE_METERS_PER_KM2 > max_km2:
        raise ApiError(400, "INVALID_REQUEST", f"bbox must be at most {max_km2} km²")
    return west, south, east, north


def bbox_polygon(box: BBox) -> dict:
    west, south, east, north = box
    ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {"type": "Polygon", "coordinates": [ring]}
