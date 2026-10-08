from datetime import datetime

import pandas as pd
import pvlib


def sun_positions(lat: float, lng: float, moments: list[datetime]) -> list[tuple[float, float]]:
    """(elevation, azimuth) in degrees for each moment; azimuth is clockwise from north."""
    positions = pvlib.solarposition.get_solarposition(pd.DatetimeIndex(moments), lat, lng)
    return list(zip(positions["apparent_elevation"], positions["azimuth"], strict=True))


def sun_elevations(lat: float, lng: float, moments: list[datetime]) -> list[float]:
    return [elevation for elevation, _ in sun_positions(lat, lng, moments)]
