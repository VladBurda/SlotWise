import asyncio
from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from redis.exceptions import RedisError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

router = APIRouter(prefix="/health", tags=["Health"])


class Liveness(BaseModel):
    status: Literal["ok"] = "ok"
    version: str = "0.1.0"


class Readiness(BaseModel):
    status: Literal["ready", "unavailable"]
    database: bool
    redis: bool


@router.get("/live", response_model=Liveness)
async def live() -> Liveness:
    return Liveness()


async def check_database(request: Request) -> bool:
    try:
        async with asyncio.timeout(request.app.state.settings.dependency_timeout_seconds):
            async with request.app.state.engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
        return True
    except (SQLAlchemyError, OSError, TimeoutError):
        return False


async def check_redis(request: Request) -> bool:
    try:
        async with asyncio.timeout(request.app.state.settings.dependency_timeout_seconds):
            return bool(await request.app.state.redis.ping())
    except (RedisError, OSError, TimeoutError):
        return False


@router.get("/ready", response_model=Readiness, responses={503: {"model": Readiness}})
async def ready(request: Request, response: Response) -> Readiness:
    database, redis = await asyncio.gather(check_database(request), check_redis(request))
    healthy = database and redis
    response.status_code = 200 if healthy else 503
    return Readiness(status="ready" if healthy else "unavailable", database=database, redis=redis)
