import pytest
from fastapi import Request, Response
from fastapi.testclient import TestClient

from app.config import settings
from app.core import middleware
from app.core.caps import MinuteLimit
from app.main import app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(settings, "origin_secret_check", False)
    monkeypatch.setattr(middleware, "per_ip", MinuteLimit(per_minute=1000))
    return TestClient(app, raise_server_exceptions=False)  # no `with`: the lifespan (database) doesn't start


def test_client_id_required(client: TestClient) -> None:
    response = client.get("/v1/meta")
    assert response.status_code == 400
    assert response.headers["X-Request-Id"]


def test_preflight_answers_empty(client: TestClient) -> None:
    assert client.options("/v1/routes/plan").status_code == 204


def test_ip_minute_limit(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(middleware, "per_ip", MinuteLimit(per_minute=2))
    codes = [client.get("/v1/meta").status_code for _ in range(3)]
    assert codes == [400, 400, 429]  # counted before the client-ID check


def test_unhandled_error_keeps_request_id(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def explode(request: Request, call_next: object) -> Response:
        raise RuntimeError("boom")

    monkeypatch.setattr(middleware, "_check_then_call", explode)
    response = client.get("/v1/meta")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert response.json()["error"]["requestId"] == response.headers["X-Request-Id"]
