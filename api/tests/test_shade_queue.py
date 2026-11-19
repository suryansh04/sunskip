import asyncio

import pytest

from app.config import settings
from app.shade import queue


@pytest.fixture
def usage(monkeypatch: pytest.MonkeyPatch) -> dict:
    state = {"month": 0, "today": 0}

    async def calls_this_month() -> int:
        return state["month"]

    async def cells_today(client_hash: str) -> int:
        return state["today"]

    monkeypatch.setattr(queue, "get_solar_calls_this_month", calls_this_month)
    monkeypatch.setattr(queue, "count_client_cells_today", cells_today)
    return state


def test_no_cells_once_month_budget_is_spent(usage: dict) -> None:
    usage["month"] = settings.solar_monthly_call_budget
    assert asyncio.run(queue.cells_allowed("device")) == 0


def test_device_gets_whats_left_today(usage: dict) -> None:
    usage["today"] = settings.max_new_cells_per_client_per_day - 5
    assert asyncio.run(queue.cells_allowed("device")) == 5


def test_portal_shares_a_bigger_daily_allowance(usage: dict) -> None:
    usage["today"] = settings.max_new_cells_portal_per_day - 7
    assert asyncio.run(queue.cells_allowed(queue.PORTAL_CLIENT)) == 7
    usage["today"] = settings.max_new_cells_portal_per_day
    assert asyncio.run(queue.cells_allowed(queue.PORTAL_CLIENT)) == 0


def test_internal_callers_get_a_full_job(usage: dict) -> None:
    assert asyncio.run(queue.cells_allowed(None)) == settings.max_cells_per_job


def test_inside_india() -> None:
    assert queue.inside_india({"type": "Point", "coordinates": [75.56, 26.84]})
    assert not queue.inside_india({"type": "LineString", "coordinates": [[75.56, 26.84], [151.2, -33.9]]})
