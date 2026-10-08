from app.core.errors import ApiError
from app.core.geo import haversine_m

SQUARE_METERS_PER_KM2 = 1_000_000

BBox = tuple[float, float, float, float]  # west, south, east, north


def parse_bbox(bbox: str, max_km2: float) -> BBox:
    try:
        west, south, east, north = (float(value) for value in bbox.split(","))
    except ValueError as error:
        raise ApiError(400, "INVALID_REQUEST", "bbox must be west,south,east,north") from error
    area_km2 = haversine_m((west, south), (east, south)) * haversine_m((west, south), (west, north))
    if west >= east or south >= north or area_km2 / SQUARE_METERS_PER_KM2 > max_km2:
        raise ApiError(400, "INVALID_REQUEST", f"bbox must be west,south,east,north and at most {max_km2} km²")
    return west, south, east, north


def bbox_polygon(box: BBox) -> dict:
    west, south, east, north = box
    ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {"type": "Polygon", "coordinates": [ring]}
