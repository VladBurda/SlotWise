from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from slotwise.core.config import Settings
from slotwise.main import create_app


def test_liveness_and_schema() -> None:
    with TestClient(create_app(Settings(environment="test"))) as client:
        assert client.get("/api/v1/health/live").json() == {"status": "ok", "version": "0.1.0"}
        assert "/api/v1/health/ready" in client.get("/api/openapi.json").json()["paths"]


@pytest.mark.parametrize(
    "database,redis", [(True, True), (False, True), (True, False), (False, False)]
)
def test_readiness(monkeypatch: pytest.MonkeyPatch, database: bool, redis: bool) -> None:
    monkeypatch.setattr("slotwise.api.v1.health.check_database", AsyncMock(return_value=database))
    monkeypatch.setattr("slotwise.api.v1.health.check_redis", AsyncMock(return_value=redis))
    with TestClient(create_app(Settings(environment="test"))) as client:
        response = client.get("/api/v1/health/ready")
    assert response.status_code == (200 if database and redis else 503)
    assert response.json()["database"] is database
    assert response.json()["redis"] is redis


def test_cors_rejects_unknown_origin_and_production_hides_docs() -> None:
    with TestClient(
        create_app(
            Settings(
                environment="production",
                mail_secret="a" * 40,
                public_url="https://example.com",
                trusted_origins=["https://example.com"],
            )
        )
    ) as client:
        response = client.get(
            "/api/v1/health/live", headers={"Origin": "https://untrusted.example"}
        )
        assert "access-control-allow-origin" not in response.headers
        assert client.get("/api/docs").status_code == 404
        assert client.get("/api/openapi.json").status_code == 404
