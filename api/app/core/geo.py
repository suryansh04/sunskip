import math
from itertools import pairwise

Point = tuple[float, float]  # (lng, lat), same order as GeoJSON

EARTH_RADIUS_M = 6371008.8
GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz"
BITS_PER_CHAR = 5


def geohash_encode(lat: float, lng: float, precision: int) -> str:
    lat_range, lng_range = [-90.0, 90.0], [-180.0, 180.0]
    chars, char_value, bit_count, use_lng = [], 0, 0, True
    while len(chars) < precision:
        value_range, value = (lng_range, lng) if use_lng else (lat_range, lat)
        middle = (value_range[0] + value_range[1]) / 2
        upper_half = value >= middle
        char_value = char_value * 2 + int(upper_half)
        value_range[0 if upper_half else 1] = middle
        use_lng, bit_count = not use_lng, bit_count + 1
        if bit_count == BITS_PER_CHAR:
            chars.append(GEOHASH_ALPHABET[char_value])
            char_value, bit_count = 0, 0
    return "".join(chars)


def haversine_m(a: Point, b: Point) -> float:
    lng1, lat1, lng2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def bearing_deg(a: Point, b: Point) -> float:
    lng1, lat1, lng2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    x = math.sin(lng2 - lng1) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lng2 - lng1)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def meters_per_degree(lat: float) -> tuple[float, float]:
    """(metres per degree of longitude, metres per degree of latitude) near this latitude."""
    lat_m_per_deg = math.pi * EARTH_RADIUS_M / 180
    return lat_m_per_deg * math.cos(math.radians(lat)), lat_m_per_deg


def offset_point(point: Point, east_m: float, north_m: float) -> Point:
    lng_m_per_deg, lat_m_per_deg = meters_per_degree(point[1])
    return (point[0] + east_m / lng_m_per_deg, point[1] + north_m / lat_m_per_deg)


def to_local_m(point: Point, origin: Point) -> tuple[float, float]:
    """(east, north) metres from origin; accurate enough over a few hundred metres."""
    lng_m_per_deg, lat_m_per_deg = meters_per_degree(origin[1])
    return (point[0] - origin[0]) * lng_m_per_deg, (point[1] - origin[1]) * lat_m_per_deg


def interpolate(a: Point, b: Point, fraction: float) -> Point:
    return (a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction)


def line_length_m(coords: list[Point]) -> float:
    return sum(haversine_m(a, b) for a, b in pairwise(coords))


def sample_line(coords: list[Point], spacing_m: float) -> list[Point]:
    samples = [coords[0]]
    distance_to_next = spacing_m
    for a, b in pairwise(coords):
        piece_m = haversine_m(a, b)
        position = distance_to_next
        while position <= piece_m:
            samples.append(interpolate(a, b, position / piece_m))
            position += spacing_m
        distance_to_next = position - piece_m
    return samples
