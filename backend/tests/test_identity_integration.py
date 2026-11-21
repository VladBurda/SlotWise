"""Real PostgreSQL tests; every test owns and drops only its UUID-named schema."""

import asyncio
import json
import os
import re
from collections.abc import AsyncIterator, Iterator
from contextlib import ExitStack
from datetime import timedelta
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from slotwise.auth.dependencies import get_db
from slotwise.auth.models import ActionToken, now
from slotwise.core.config import Settings
from slotwise.db import models  # noqa: F401
from slotwise.db.base import Base
from slotwise.main import create_app
from slotwise.notifications.mail import cipher, deliver_one
from slotwise.notifications.models import AuthMail
from slotwise.tenants.models import Workspace

pytestmark = pytest.mark.skipif(
    os.getenv("SLOTWISE_INTEGRATION") != "1", reason="Real PostgreSQL required"
)
PASSWORD = "A-long-test-password-42"
ORIGIN = "http://localhost:5173"


class Harness:
    def __init__(
        self, factory: async_sessionmaker[AsyncSession], settings: Settings, stack: ExitStack
    ):
        self.factory, self.settings, self.stack = factory, settings, stack

    def client(self, **overrides: Any) -> TestClient:
        config = self.settings.model_copy(update=overrides)
        app = create_app(config)

        async def scoped_db() -> AsyncIterator[AsyncSession]:
            async with self.factory() as db:
                yield db

        app.dependency_overrides[get_db] = scoped_db
        client = self.stack.enter_context(TestClient(app, client=(str(uuid4()), 50000)))
        client.get("/api/v1/auth/csrf")
        return client

    @staticmethod
    def post(
        client: TestClient, path: str, data: dict[str, Any] | None = None, method: str = "POST"
    ) -> Any:
        return client.request(
            method,
            f"/api/v1{path}",
            json=data,
            headers={
                "Origin": ORIGIN,
                "X-CSRF-Token": client.cookies.get("sw_csrf", ""),
            },
        )

    def link(self, email: str, subject: str) -> str:
        async def read() -> str:
            async with self.factory() as db:
                rows = (
                    await db.scalars(select(AuthMail).order_by(AuthMail.next_attempt.desc()))
                ).all()
                for mail in rows:
                    if not mail.payload:
                        continue
                    payload = json.loads(cipher(self.settings).decrypt(mail.payload.encode()))
                    if payload["to"] == email and subject in payload["subject"]:
                        return re.search(r"#token=([A-Za-z0-9_-]+)", payload["body"])[1]
            raise AssertionError("No mail found")

        return asyncio.run(read())

    def account(self, email: str = "owner@example.com", verified: bool = True) -> TestClient:
        client = self.client()
        response = self.post(
            client, "/auth/register", {"email": email, "name": "Test Owner", "password": PASSWORD}
        )
        assert response.status_code == 202, response.text
        if verified:
            response = self.post(
                client, "/auth/verify-email", {"token": self.link(email, "Verify")}
            )
            assert response.status_code == 200, response.text
        response = self.post(client, "/auth/login", {"email": email, "password": PASSWORD})
        assert response.status_code == 200, response.text
        return client

    def workspace(self, client: TestClient, slug: str = "test-workspace") -> str:
        response = self.post(
            client,
            "/workspaces",
            {"name": "Test Workspace", "slug": slug, "timezone": "Europe/Berlin"},
        )
        assert response.status_code == 201, response.text
        return str(response.json()["id"])


@pytest.fixture
def harness() -> Iterator[Harness]:
    settings = Settings(environment="test", mail_worker_enabled=False)
    schema = "test_identity_" + uuid4().hex
    admin = create_async_engine(settings.database_url.get_secret_value(), poolclass=NullPool)
    engine = create_async_engine(
        settings.database_url.get_secret_value(),
        poolclass=NullPool,
        connect_args={"server_settings": {"search_path": schema}},
    )

    async def setup() -> None:
        async with admin.begin() as connection:
            await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def cleanup() -> None:
        async with admin.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await engine.dispose()
        await admin.dispose()

    asyncio.run(setup())
    try:
        with ExitStack() as stack:
            yield Harness(async_sessionmaker(engine, expire_on_commit=False), settings, stack)
    finally:
        asyncio.run(cleanup())


def test_registration_verification_cookies_and_logout(harness: Harness) -> None:
    client = harness.account(verified=False)
    assert client.get("/api/v1/auth/me").json()["verified"] is False
    assert (
        harness.post(client, "/workspaces", {"name": "Test", "slug": "test-one"}).status_code == 403
    )
    raw = harness.link("owner@example.com", "Verify")
    assert harness.post(client, "/auth/verify-email", {"token": raw}).status_code == 200
    assert harness.post(client, "/auth/verify-email", {"token": raw}).status_code == 400
    harness.workspace(client)
    old_access = client.cookies.get("sw_access")
    response = harness.post(
        client, "/auth/login", {"email": "owner@example.com", "password": PASSWORD}
    )
    assert "HttpOnly" in response.headers.get_list("set-cookie")[0]
    assert "SameSite=strict" in response.headers.get_list("set-cookie")[0]
    assert client.cookies.get("sw_access") != old_access
    access = client.cookies.get("sw_access")
    assert harness.post(client, "/auth/logout").status_code == 200
    client.cookies.set("sw_access", access)
    assert client.get("/api/v1/auth/me").status_code == 401


def test_refresh_rotation_and_reuse_revoke_family(harness: Harness) -> None:
    client = harness.account()
    stolen = harness.client()
    stolen.cookies.update(client.cookies)
    old = client.cookies.get("sw_refresh")
    assert harness.post(client, "/auth/refresh").status_code == 200
    assert client.cookies.get("sw_refresh") != old
    assert harness.post(stolen, "/auth/refresh").json()["error"]["code"] == "session_reused"
    assert client.get("/api/v1/auth/me").status_code == 401
    assert harness.post(client, "/auth/refresh").status_code == 401


def test_reset_revokes_all_sessions_and_single_use(harness: Harness) -> None:
    client = harness.account()
    other = harness.client()
    harness.post(other, "/auth/login", {"email": "owner@example.com", "password": PASSWORD})
    assert (
        harness.post(
            client, "/auth/request-password-reset", {"email": "owner@example.com"}
        ).status_code
        == 202
    )
    raw = harness.link("owner@example.com", "Reset")
    assert (
        harness.post(
            client, "/auth/reset-password", {"token": raw, "password": PASSWORD + "new"}
        ).status_code
        == 200
    )
    assert client.get("/api/v1/auth/me").status_code == 401
    assert other.get("/api/v1/auth/me").status_code == 401
    assert (
        harness.post(
            client, "/auth/reset-password", {"token": raw, "password": PASSWORD}
        ).status_code
        == 400
    )
    assert (
        harness.post(
            client, "/auth/login", {"email": "owner@example.com", "password": PASSWORD}
        ).status_code
        == 401
    )
    assert (
        harness.post(
            client, "/auth/login", {"email": "owner@example.com", "password": PASSWORD + "new"}
        ).status_code
        == 200
    )


def test_csrf_origin_validation_and_safe_errors(harness: Harness) -> None:
    client = harness.account()
    assert client.post("/api/v1/auth/logout").status_code == 403
    assert (
        client.post(
            "/api/v1/auth/logout",
            headers={
                "Origin": "https://attacker.example",
                "X-CSRF-Token": client.cookies.get("sw_csrf"),
            },
        ).status_code
        == 403
    )
    assert client.get("/api/v1/auth/me").status_code == 200
    response = harness.post(
        client, "/auth/register", {"email": "bad", "name": "Test", "password": "secret"}
    )
    assert response.status_code == 422
    assert "secret" not in response.text
    a = harness.post(client, "/auth/request-password-reset", {"email": "missing@example.com"})
    b = harness.post(client, "/auth/request-password-reset", {"email": "owner@example.com"})
    assert a.json() == b.json()


@pytest.mark.parametrize("role", ["manager", "employee", "customer"])
def test_tenant_isolation_and_backend_roles(harness: Harness, role: str) -> None:
    owner = harness.account()
    workspace = harness.workspace(owner)
    other = harness.account("other@example.com")
    foreign = harness.workspace(other, "other-workspace")
    assert other.get(f"/api/v1/workspaces/{workspace}").status_code == 404
    assert other.get(f"/api/v1/workspaces/{workspace}/members").status_code == 404
    assert (
        harness.post(
            other,
            f"/workspaces/{workspace}/invitations",
            {"email": "invite@example.com", "role": role},
        ).status_code
        == 404
    )
    invite = harness.post(
        owner, f"/workspaces/{workspace}/invitations", {"email": "other@example.com", "role": role}
    )
    assert invite.status_code == 201, invite.text
    raw = harness.link("other@example.com", "invitation")
    assert harness.post(owner, "/invitations/accept", {"token": raw}).status_code == 403
    assert harness.post(other, "/invitations/accept", {"token": raw}).status_code == 200
    assert harness.post(other, "/invitations/accept", {"token": raw}).status_code == 400
    assert {item["id"] for item in other.get("/api/v1/workspaces").json()} == {workspace, foreign}
    assert other.get(f"/api/v1/workspaces/{workspace}/members").status_code == (
        200 if role == "manager" else 403
    )
    assert (
        harness.post(
            other,
            f"/workspaces/{workspace}/invitations",
            {"email": "x@example.com", "role": "owner"},
        ).status_code
        == 403
    )
    me = other.get("/api/v1/auth/me").json()["id"]
    assert (
        harness.post(
            other, f"/workspaces/{workspace}/members/{me}", {"role": "owner"}, "PATCH"
        ).status_code
        == 403
    )
    assert (
        harness.post(owner, f"/workspaces/{workspace}/members/{me}", method="DELETE").status_code
        == 200
    )
    assert other.get(f"/api/v1/workspaces/{workspace}").status_code == 404


def test_last_owner_slug_conflicts_and_revoke_invitation(harness: Harness) -> None:
    owner = harness.account()
    workspace = harness.workspace(owner)
    me = owner.get("/api/v1/auth/me").json()["id"]
    for method, data in [("PATCH", {"role": "employee"}), ("DELETE", None)]:
        assert (
            harness.post(owner, f"/workspaces/{workspace}/members/{me}", data, method).status_code
            == 409
        )
    assert (
        harness.post(
            owner, "/workspaces", {"name": "Duplicate", "slug": "test-workspace"}
        ).status_code
        == 409
    )
    invitee = harness.account("invite@example.com")
    invite = harness.post(
        owner,
        f"/workspaces/{workspace}/invitations",
        {"email": "invite@example.com", "role": "employee"},
    ).json()
    raw = harness.link("invite@example.com", "invitation")
    assert (
        harness.post(
            owner, f"/workspaces/{workspace}/invitations/{invite['id']}", method="DELETE"
        ).status_code
        == 200
    )
    assert harness.post(invitee, "/invitations/accept", {"token": raw}).status_code == 400


def test_expired_tokens_and_suspended_workspace(harness: Harness) -> None:
    client = harness.account(verified=False)
    raw = harness.link("owner@example.com", "Verify")

    async def expire() -> None:
        async with harness.factory() as db, db.begin():
            await db.execute(update(ActionToken).values(expires_at=now() - timedelta(seconds=1)))

    asyncio.run(expire())
    assert harness.post(client, "/auth/verify-email", {"token": raw}).status_code == 400
    assert (
        harness.post(
            client, "/auth/request-verification", {"email": "owner@example.com"}
        ).status_code
        == 202
    )
    raw = harness.link("owner@example.com", "Verify")
    assert harness.post(client, "/auth/verify-email", {"token": raw}).status_code == 200
    workspace = harness.workspace(client)

    async def suspend() -> None:
        async with harness.factory() as db, db.begin():
            await db.execute(update(Workspace).values(suspended=True))

    asyncio.run(suspend())
    assert client.get(f"/api/v1/workspaces/{workspace}").status_code == 404
    assert client.get("/api/v1/workspaces").json() == []


def test_real_redis_rate_limit(harness: Harness) -> None:
    client = harness.client(auth_rate_limit=2)
    for _ in range(2):
        assert (
            harness.post(
                client, "/auth/login", {"email": "missing@example.com", "password": PASSWORD}
            ).status_code
            == 401
        )
    response = harness.post(
        client, "/auth/login", {"email": "missing@example.com", "password": PASSWORD}
    )
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "60"


def test_encrypted_outbox_retries_and_deduplication(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = harness.client()
    harness.post(
        client,
        "/auth/register",
        {"email": "mail@example.com", "name": "Mail", "password": PASSWORD},
    )
    calls: list[str] = []

    def fail(settings: Settings, mail: AuthMail) -> None:
        assert "mail@example.com" not in mail.payload and "#token=" not in mail.payload
        raise OSError("private SMTP details")

    monkeypatch.setattr("slotwise.notifications.mail.send_mail", fail)
    assert asyncio.run(deliver_one(harness.factory, harness.settings))

    async def retry() -> None:
        async with harness.factory() as db, db.begin():
            mail = await db.scalar(select(AuthMail))
            assert mail is not None and mail.attempts == 1 and mail.last_error == "OSError"
            mail.next_attempt = now()

    asyncio.run(retry())
    monkeypatch.setattr(
        "slotwise.notifications.mail.send_mail", lambda settings, mail: calls.append(str(mail.id))
    )
    assert asyncio.run(deliver_one(harness.factory, harness.settings))
    assert not asyncio.run(deliver_one(harness.factory, harness.settings))
    assert len(calls) == 1


def test_concurrent_refresh_is_single_use(harness: Harness) -> None:
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    first = harness.account()
    second = harness.client()
    second.cookies.update(first.cookies)
    barrier = Barrier(2)

    def refresh(client: TestClient) -> int:
        barrier.wait(timeout=5)
        return int(harness.post(client, "/auth/refresh").status_code)

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(refresh, [first, second]))
    assert sorted(statuses) == [200, 401]
    assert first.get("/api/v1/auth/me").status_code == 401
    assert second.get("/api/v1/auth/me").status_code == 401


def test_concurrent_owner_demotion_keeps_an_owner(harness: Harness) -> None:
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    first = harness.account()
    second = harness.account("second@example.com")
    workspace = harness.workspace(first)
    harness.post(
        first,
        f"/workspaces/{workspace}/invitations",
        {
            "email": "second@example.com",
            "role": "owner",
        },
    )
    raw = harness.link("second@example.com", "invitation")
    assert harness.post(second, "/invitations/accept", {"token": raw}).status_code == 200
    users = [client.get("/api/v1/auth/me").json()["id"] for client in [first, second]]
    barrier = Barrier(2)

    def demote(pair: tuple[TestClient, str]) -> int:
        client, user_id = pair
        barrier.wait(timeout=5)
        return int(
            harness.post(
                client, f"/workspaces/{workspace}/members/{user_id}", {"role": "manager"}, "PATCH"
            ).status_code
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(demote, zip([first, second], users, strict=True)))
    assert sorted(statuses) == [200, 409]


def test_access_expiry_refresh_and_hashed_storage(harness: Harness) -> None:
    from slotwise.auth.models import RefreshToken, Session, User
    from slotwise.auth.security import digest

    client = harness.account()
    access, refresh = client.cookies.get("sw_access"), client.cookies.get("sw_refresh")

    async def expire_access() -> None:
        async with harness.factory() as db, db.begin():
            session = await db.scalar(select(Session))
            user = await db.scalar(select(User))
            assert session is not None and session.access_hash == digest(access)
            assert user is not None and user.password_hash.startswith("$argon2id$")
            assert await db.get(RefreshToken, digest(refresh)) is not None
            session.access_expires = now() - timedelta(seconds=1)

    asyncio.run(expire_access())
    assert client.get("/api/v1/auth/me").status_code == 401
    assert harness.post(client, "/auth/refresh").status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 200
