"""Read-only checks against the migrated local Compose database and Redis."""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from slotwise.core.config import Settings
from slotwise.main import create_app

pytestmark = pytest.mark.skipif(
    os.environ.get("SLOTWISE_INTEGRATION") != "1",
    reason="Set SLOTWISE_INTEGRATION=1 with the migrated PostgreSQL/Redis stack running",
)


def test_real_dependencies_are_ready() -> None:
    with TestClient(create_app(Settings(environment="test"))) as client:
        response = client.get("/api/v1/health/ready")
        assert response.status_code == 200
        assert response.json() == {"status": "ready", "database": True, "redis": True}


async def test_postgres_migration_and_exclusion_extension() -> None:
    engine = create_async_engine(Settings().database_url.get_secret_value())
    try:
        async with engine.connect() as connection:
            assert (
                await connection.scalar(text("SELECT version_num FROM alembic_version")) == "0006"
            )
            assert (
                await connection.scalar(
                    text("SELECT count(*) FROM pg_extension WHERE extname = 'btree_gist'")
                )
                == 1
            )
    finally:
        await engine.dispose()
