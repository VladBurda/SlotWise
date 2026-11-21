import hmac
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from slotwise.auth.models import Session, User, now
from slotwise.auth.security import digest
from slotwise.core.config import Settings
from slotwise.core.errors import DomainError


def cookie_name(settings: Settings, kind: str) -> str:
    return ("__Host-" if settings.environment == "production" else "") + f"sw_{kind}"


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessions() as db:
        yield db


Db = Annotated[AsyncSession, Depends(get_db)]


def csrf(request: Request) -> str:
    settings: Settings = request.app.state.settings
    value = request.cookies.get(cookie_name(settings, "csrf"), "")
    header = request.headers.get("X-CSRF-Token", "")
    if (
        request.headers.get("origin") not in settings.trusted_origins
        or len(value) != 43
        or not hmac.compare_digest(value.encode(), header.encode())
    ):
        raise DomainError(403, "csrf_failed", "Reload the page and try again.")
    return value


async def rate_limit(request: Request) -> None:
    settings: Settings = request.app.state.settings
    client = request.client.host if request.client else "unknown"
    # Do not trust arbitrary X-Forwarded-For; the reverse proxy is the rate-limit scope.
    key = f"auth-rate:{digest(client)}:{request.url.path}"
    redis: Redis = request.app.state.redis
    try:
        count = await redis.execute_command(  # type: ignore[no-untyped-call]
            "EVAL",
            "local n=redis.call('INCR',KEYS[1]); "
            "if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
            1,
            key,
        )
    except RedisError as error:
        raise DomainError(503, "auth_unavailable", "Sign-in is temporarily unavailable.") from error
    if int(count) > settings.auth_rate_limit:
        raise DomainError(429, "rate_limited", "Too many attempts. Try again in a minute.")


@dataclass
class Identity:
    user: User
    session: Session


async def identity(request: Request, db: Db) -> Identity:
    settings: Settings = request.app.state.settings
    raw = request.cookies.get(cookie_name(settings, "access"), "")
    session = await db.scalar(
        select(Session).where(
            Session.access_hash == digest(raw),
            Session.revoked.is_(False),
            Session.access_expires > now(),
            Session.expires_at > now(),
        )
    )
    if session is None:
        raise DomainError(401, "unauthenticated", "Please sign in.")
    user = await db.get(User, session.user_id)
    if user is None:
        raise DomainError(401, "unauthenticated", "Please sign in.")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if not hmac.compare_digest(session.csrf_hash, digest(csrf(request))):
            raise DomainError(403, "csrf_failed", "Reload the page and try again.")
    return Identity(user, session)


Current = Annotated[Identity, Depends(identity)]


def require_verified(current: Identity) -> None:
    if not current.user.verified:
        raise DomainError(
            403, "email_unverified", "Verify your email before setting up a workspace."
        )
