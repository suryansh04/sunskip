import asyncio

import pytest

from app.agent import tools


def test_unexpected_tool_error_goes_back_to_claude(monkeypatch: pytest.MonkeyPatch) -> None:
    async def broken(tool_input: dict, context: object) -> str:
        raise TimeoutError("database went away")

    monkeypatch.setitem(tools.RUNNERS, "plan_route", broken)
    text, failed = asyncio.run(tools.run_tool("plan_route", {}, None))
    assert failed
    assert text.startswith("Could not answer")
