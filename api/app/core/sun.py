from datetime import datetime

import pandas as pd
import pvlib


def sun_elevations(lat: float, lng: float, moments: list[datetime]) -> list[float]:
    positions = pvlib.solarposition.get_solarposition(pd.DatetimeIndex(moments), lat, lng)
    return positions["apparent_elevation"].tolist()
