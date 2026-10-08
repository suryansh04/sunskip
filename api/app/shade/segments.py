"""The shade map: every shade-ready segment in a small box, with its sun at one month and hour (api.md endpoint 6)."""

from app.config import settings
from app.contracts.ids import segment_code, stretch_code
from app.contracts.models import Shade
from app.core.formulas import round_half_up, round_whole
from app.db.shade_queries import load_shade_map
from app.shade.bbox import bbox_polygon, parse_bbox
from app.shade.queue import ensure_shade

SUN_FRACTION_PLACES = 2


async def shade_map(bbox: str, month: int, hour: int, client_hash: str | None) -> tuple[dict, Shade]:
    """(GeoJSON answer, shade status). Queues shade for the box if it's missing."""
    box = parse_bbox(bbox, settings.max_shade_map_km2)
    shade = await ensure_shade(bbox_polygon(box), 0, "MAP", client_hash)
    features = [
        {
            "type": "Feature",
            "properties": {
                "id": segment_code(row["id"]),
                "sunFraction": round_half_up(row["sun_fraction"], SUN_FRACTION_PLACES),
                "lengthM": round_whole(row["length_m"]),
                "stretchId": stretch_code(row["stretch_id"]),
            },
            "geometry": row["geometry"],
        }
        for row in await load_shade_map(box, month, hour)
    ]
    shade_json = shade.model_dump(mode="json", by_alias=True)
    answer = {"month": month, "hour": hour, "shade": shade_json, "type": "FeatureCollection", "features": features}
    return answer, shade
