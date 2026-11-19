from itertools import pairwise

import pytest

from app.core.formulas import heat_weight, hour_label, round_half_up
from app.core.geo import geohash_encode, haversine_m, sample_line


def test_round_half_up_ignores_float_noise() -> None:
    assert round_half_up(11.2499999999, 1) == 11.3
    assert round_half_up(2.25, 1) == 2.3  # plain round() gives 2.2
    assert round_half_up(None) is None


@pytest.mark.parametrize(("feels_like", "weight"), [(None, 1.0), (25, 0.0), (35, 0.5), (40, 1.0), (45, 2.0)])
def test_heat_weight_bands(feels_like: float | None, weight: float) -> None:
    assert heat_weight(feels_like) == weight


def test_hour_label() -> None:
    assert [hour_label(h) for h in (0, 7, 12, 13)] == ["12 AM", "7 AM", "12 PM", "1 PM"]


def test_geohash_known_value() -> None:
    assert geohash_encode(57.64911, 10.40744, 11) == "u4pruydqqvj"


def test_sample_line_spacing() -> None:
    start, end = (75.565, 26.843), (75.566, 26.843)  # about 99 m apart
    points = sample_line([start, end], 5)
    assert points[0] == start
    gaps = [haversine_m(a, b) for a, b in pairwise(points)]
    assert all(gap == pytest.approx(5, abs=0.6) for gap in gaps)
