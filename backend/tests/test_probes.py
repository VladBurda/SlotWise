import asyncio
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import Request
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy.exc import OperationalError

from slotwise.api.v1.health import check_database, check_redis


def request_for(*, engine: object = None, redis: object = None) -> Request:
    return cast(
        Request,
        SimpleNamespace(
            app=SimpleNamespace(
                state=SimpleNamespace(
                    settings=SimpleNamespace(dependency_timeout_seconds=0.01),
                    engine=engine,
                    redis=redis,
                )
            )
        ),
    )


async def test_database_connection_error_is_unavailable() -> None:
    engine = MagicMock()
    engine.connect.return_value.__aenter__.side_effect = OperationalError(
        "SELECT 1",
        {},
        Exception("private connection detail"),
    )
    assert not await check_database(request_for(engine=engine))


async def test_redis_connection_error_is_unavailable() -> None:
    redis = SimpleNamespace(ping=AsyncMock(side_effect=RedisConnectionError("private detail")))
    assert not await check_redis(request_for(redis=redis))


async def test_slow_probe_times_out() -> None:
    async def slow_ping() -> bool:
        await asyncio.sleep(1)
        return True

    assert not await check_redis(request_for(redis=SimpleNamespace(ping=slow_ping)))


async def test_unexpected_programming_errors_are_not_hidden() -> None:
    redis = SimpleNamespace(ping=AsyncMock(side_effect=RuntimeError("bug")))
    with pytest.raises(RuntimeError, match="bug"):
        await check_redis(request_for(redis=redis))
