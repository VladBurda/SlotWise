import asyncio
import os
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import update
from test_booking_integration import configured, send
from test_identity_integration import Harness

from slotwise.auth.models import Session
from slotwise.tenants.models import Membership

pytestmark = pytest.mark.skipif(
    os.getenv("SLOTWISE_INTEGRATION") != "1", reason="PostgreSQL required"
)


def prepare(harness: Harness) -> tuple[Any, str, dict[str, Any]]:
    owner, wid, data, _ = configured(harness)
    owner.app.state.sessions = harness.factory
    return owner, wid, data


def test_revision_is_atomic_idempotent_and_tenant_scoped(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import UTC, datetime

    for module in ("bookings", "service", "guards"):
        monkeypatch.setattr(
            f"slotwise.scheduling.{module}.now", lambda: datetime(2026, 11, 21, tzinfo=UTC)
        )
    owner, wid, data = prepare(harness)
    path = f"/api/v1/workspaces/{wid}/calendar/revision"
    assert owner.get(path).json() == {"revision": "0"}
    key = uuid4()
    booking = send(owner, wid, data, key).json()
    assert owner.get(path).json() == {"revision": "1"}
    assert send(owner, wid, data, key).status_code == 201
    assert send(owner, wid, data).status_code == 409
    assert owner.get(path).json() == {"revision": "1"}
    assert (
        send(
            owner, wid, {"version": booking["version"]}, suffix=f"/{booking['id']}/cancel"
        ).status_code
        == 200
    )
    assert owner.get(path).json() == {"revision": "2"}
    other = harness.account("other@example.com")
    other.app.state.sessions = harness.factory
    other_wid = harness.workspace(other, "other")
    assert other.get(path).status_code == 404
    assert other.get(f"/api/v1/workspaces/{other_wid}/calendar/revision").json() == {
        "revision": "0"
    }


def test_stream_auth_origin_and_live_membership_checks(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    from slotwise.scheduling import realtime

    owner, wid, _ = prepare(harness)
    path = f"/api/v1/workspaces/{wid}/calendar/events"
    monkeypatch.setattr(realtime, "POLL_SECONDS", 0)
    monkeypatch.setattr(realtime, "STREAM_CHECKS", 1)
    assert owner.get(path, headers={"Origin": "https://untrusted.example"}).status_code == 403
    response = owner.get(path)
    assert response.status_code == 200
    assert response.headers["x-accel-buffering"] == "no"
    assert 'event: ready\ndata: {"revision":"0"}' in response.text
    assert "event: reconnect" in response.text
    assert "event: heartbeat" in response.text
    original = realtime.read_revision
    reads = 0

    async def revoke(request: Any, workspace_id: UUID) -> int:
        nonlocal reads
        reads += 1
        if reads == 2:
            async with harness.factory() as db:
                await db.execute(
                    update(Membership)
                    .where(Membership.workspace_id == workspace_id)
                    .values(role="employee")
                )
                await db.commit()
        return await original(request, workspace_id)

    monkeypatch.setattr(realtime, "read_revision", revoke)
    assert "event: access-lost" in owner.get(path).text
    assert owner.get(f"/api/v1/workspaces/{wid}/calendar/revision").status_code == 403

    async def logout() -> None:
        async with harness.factory() as db:
            await db.execute(update(Session).values(revoked=True))
            await db.commit()

    asyncio.run(logout())
    assert owner.get(path).status_code == 401
