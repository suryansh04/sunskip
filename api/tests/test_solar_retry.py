import asyncio

import httpx
import pytest

from app.worker import solar

LAYERS = {
    "hourlyShadeUrls": [f"https://example.test/m{m}?x=1" for m in range(1, 13)],
    "imageryDate": {"year": 2025, "month": 3, "day": 1},
    "imageryQuality": "HIGH",
}


@pytest.fixture
def google(monkeypatch: pytest.MonkeyPatch) -> dict:
    """Fakes Google and the database. The month-3 file fails once."""
    state = {"reserved": 0, "layer_calls": 0, "downloads": [], "failures": 0, "ready": False, "failed_once": False}

    async def reserve(budget: int) -> bool:
        state["reserved"] += 1
        return True

    async def layers(lat: float, lng: float) -> dict:
        state["layer_calls"] += 1
        return LAYERS

    async def download(url: str) -> bytes:
        state["downloads"].append(url)
        if "m3?" in url and not state["failed_once"]:
            state["failed_once"] = True
            raise httpx.ConnectError("blip")
        return b"tif"

    async def claim(geohash: str) -> dict:
        return {"lat": 26.84, "lng": 75.56}

    async def failure(geohash: str, error: str, give_up: bool) -> None:
        state["failures"] += 1

    async def ready(*args: object) -> None:
        state["ready"] = True

    real_sleep = asyncio.sleep

    async def no_sleep(seconds: float) -> None:
        await real_sleep(0)

    monkeypatch.setattr(solar, "reserve_solar_call", reserve)
    monkeypatch.setattr(solar, "get_data_layers", layers)
    monkeypatch.setattr(solar, "download_layer", download)
    monkeypatch.setattr(solar, "claim_cell", claim)
    monkeypatch.setattr(solar, "record_cell_failure", failure)
    monkeypatch.setattr(solar, "mark_cell_ready", ready)
    monkeypatch.setattr(solar, "save_file", lambda path, content: None)
    monkeypatch.setattr(solar.asyncio, "sleep", no_sleep)
    return state


def test_retry_fetches_only_the_failed_file(google: dict) -> None:
    assert asyncio.run(solar.fetch_cell("tsq4b2c")) is False
    assert google["ready"]
    assert google["failures"] == 1
    assert google["reserved"] == 1  # one paid Solar call, not one per attempt
    assert google["layer_calls"] == 1
    assert len(google["downloads"]) == 13  # 12 files plus one retry of the file that failed
