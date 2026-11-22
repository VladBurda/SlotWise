import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from test_catalog_integration import create, setup
from test_identity_integration import Harness

from slotwise.scheduling.models import Allocation, Appointment, BookingEvent, BookingRequest

pytestmark = pytest.mark.skipif(
    os.getenv("SLOTWISE_INTEGRATION") != "1", reason="PostgreSQL required"
)


@pytest.fixture(autouse=True)
def freeze_time(monkeypatch: pytest.MonkeyPatch) -> None:
    for module in ("bookings", "service", "guards"):
        monkeypatch.setattr(
            f"slotwise.scheduling.{module}.now", lambda: datetime(2026, 11, 21, tzinfo=UTC)
        )


def configured(
    harness: Harness, capacity: int = 1
) -> tuple[Any, str, dict[str, Any], dict[str, Any]]:
    owner, wid, loc = setup(harness)
    schedule = {"weekly": [{"weekday": 0, "start": 540, "end": 1020}]}
    staff = create(
        harness, owner, wid, "staff", location_id=loc, capacity=capacity, availability=schedule
    )
    resource = create(
        harness,
        owner,
        wid,
        "resources",
        location_id=loc,
        capacity=capacity,
        resource_type="room",
        availability=schedule,
    )
    service = create(
        harness,
        owner,
        wid,
        "services",
        location_ids=[loc],
        buffer_after_minutes=15,
        requirements=[{"resource_id": resource["id"]}],
    )
    data = {
        "service_id": service["id"],
        "location_id": loc,
        "starts_at": "2026-11-23T08:00:00Z",
        "duration_minutes": 30,
        "customer_name": "Customer",
    }
    return owner, wid, data, staff


def send(
    client: Any, wid: str, data: dict[str, Any], key: UUID | None = None, suffix: str = ""
) -> Any:
    return client.post(
        f"/api/v1/workspaces/{wid}/bookings{suffix}",
        json=data,
        headers={
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": client.cookies.get("sw_csrf", ""),
            "Idempotency-Key": str(key or uuid4()),
        },
    )


def counts(harness: Harness) -> tuple[int, ...]:
    async def read() -> tuple[int, ...]:
        async with harness.factory() as db:
            return tuple(
                [
                    int(await db.scalar(select(func.count()).select_from(model)) or 0)
                    for model in (Appointment, Allocation, BookingRequest, BookingEvent)
                ]
            )

    return asyncio.run(read())


def test_booking_retry_conflict_cancel_and_history(harness: Harness) -> None:
    owner, wid, data, staff = configured(harness)
    key = uuid4()
    response = send(owner, wid, data, key)
    assert response.status_code == 201, response.text
    receipt = response.json()
    assert send(owner, wid, data, key).json() == receipt
    assert send(owner, wid, {**data, "customer_name": "Different"}, key).status_code == 409
    assert send(owner, wid, data).status_code == 409
    assert counts(harness) == (1, 2, 1, 1)
    availability = owner.get(
        f"/api/v1/workspaces/{wid}/availability",
        params={
            "service_id": data["service_id"],
            "location_id": data["location_id"],
            "start": "2026-11-23",
        },
    ).json()
    assert availability["slots"][0]["starts_at"] == "2026-11-23T08:45:00Z"
    params = {
        "service_id": data["service_id"],
        "location_id": data["location_id"],
        "start": "2026-11-23",
        "exclude_booking_id": receipt["id"],
    }
    editable = owner.get(f"/api/v1/workspaces/{wid}/availability", params=params)
    assert editable.json()["slots"][0]["starts_at"] == data["starts_at"]
    missing = owner.get(
        f"/api/v1/workspaces/{wid}/availability",
        params={**params, "exclude_booking_id": str(uuid4())},
    )
    assert missing.status_code == 404
    blocked = harness.post(
        owner,
        f"/workspaces/{wid}/catalog/staff/{staff['id']}",
        {**staff["data"], "active": False},
        "PATCH",
    )
    assert blocked.status_code == 409
    cancelled = send(owner, wid, {"version": 1}, suffix=f"/{receipt['id']}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert counts(harness) == (1, 0, 2, 2)
    assert send(owner, wid, data, key).json() == receipt  # Original receipt survives cancellation.
    assert send(owner, wid, data).status_code == 201


def test_reschedule_failure_preserves_original_and_success_replaces_it(harness: Harness) -> None:
    owner, wid, data, _ = configured(harness)
    first = send(owner, wid, data).json()
    second = send(owner, wid, {**data, "starts_at": "2026-11-23T09:00:00Z"}).json()
    suffix = f"/{first['id']}/reschedule"
    conflict = send(
        owner, wid, {**data, "starts_at": second["slot"]["starts_at"], "version": 1}, suffix=suffix
    )
    assert conflict.status_code == 409
    assert counts(harness) == (2, 4, 2, 2)
    moved = send(
        owner, wid, {**data, "starts_at": "2026-11-23T10:00:00Z", "version": 1}, suffix=suffix
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["version"] == 2
    assert counts(harness) == (2, 4, 3, 3)
    assert send(owner, wid, {"version": 1}, suffix=f"/{first['id']}/cancel").status_code == 409
    assert send(owner, wid, data).status_code == 201  # Old allocation released.


@pytest.mark.parametrize("capacity", [1, 2])
def test_concurrent_capacity_claims(harness: Harness, capacity: int) -> None:
    owner, wid, data, _ = configured(harness, capacity)
    barrier = Barrier(capacity + 1)

    def attempt(_: int) -> int:
        barrier.wait()
        return int(send(owner, wid, data).status_code)

    with ThreadPoolExecutor(max_workers=capacity + 1) as pool:
        statuses = list(pool.map(attempt, range(capacity + 1)))
    assert sorted(statuses) == [201] * capacity + [409]
    assert counts(harness) == (capacity, 2 * capacity, capacity, capacity)


def test_concurrent_idempotent_retries(harness: Harness) -> None:
    owner, wid, data, _ = configured(harness)
    barrier, key = Barrier(2), uuid4()

    def attempt(_: int) -> Any:
        barrier.wait()
        return send(owner, wid, data, key)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(attempt, range(2)))
    assert all(r.status_code == 201 for r in responses)
    assert responses[0].json() == responses[1].json()
    assert counts(harness) == (1, 2, 1, 1)


def test_database_exclusion_and_tenant_foreign_key(harness: Harness) -> None:
    owner, wid, data, _ = configured(harness)
    first = send(owner, wid, data).json()
    second = send(owner, wid, {**data, "starts_at": "2026-11-23T09:00:00Z"}).json()

    async def attack() -> None:
        async with harness.factory() as db:
            allocation = await db.scalar(
                select(Allocation).where(Allocation.appointment_id == UUID(first["id"]))
            )
            assert allocation is not None
            unit, start, end = allocation.unit_id, allocation.starts_at, allocation.ends_at
            await db.execute(
                Allocation.__table__.delete().where(Allocation.appointment_id == UUID(second["id"]))
            )
            await db.commit()
            db.add(
                Allocation(
                    workspace_id=UUID(wid),
                    appointment_id=UUID(second["id"]),
                    unit_id=unit,
                    starts_at=start,
                    ends_at=end,
                )
            )
            with pytest.raises(IntegrityError) as error:
                await db.commit()
            assert error.value.orig.sqlstate == "23P01"
            await db.rollback()
            db.add(
                Allocation(
                    workspace_id=uuid4(),
                    appointment_id=UUID(second["id"]),
                    unit_id=unit,
                    starts_at=datetime(2026, 12, 1, tzinfo=UTC),
                    ends_at=datetime(2026, 12, 2, tzinfo=UTC),
                )
            )
            with pytest.raises(IntegrityError) as error:
                await db.commit()
            assert error.value.orig.sqlstate == "23503"

    asyncio.run(attack())


def test_validation_policy_and_access(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    owner, wid, data, _ = configured(harness)
    assert send(owner, wid, {**data, "starts_at": "2026-11-23T08:00:00"}).status_code == 422
    assert send(owner, wid, {**data, "starts_at": "2099-12-31T23:30:00Z"}).status_code == 422
    assert send(owner, wid, {**data, "starts_at": "2026-11-23T08:01:00Z"}).status_code == 409
    assert send(owner, wid, {**data, "duration_minutes": 35}).status_code == 422
    stranger = harness.account("stranger@example.com")
    assert send(stranger, wid, data).status_code == 404
    assert (
        owner.post(
            f"/api/v1/workspaces/{wid}/bookings",
            json=data,
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 403
    )
    receipt = send(owner, wid, data).json()
    monkeypatch.setattr(
        "slotwise.scheduling.bookings.now", lambda: datetime(2026, 11, 23, tzinfo=UTC)
    )
    assert send(owner, wid, {"version": 1}, suffix=f"/{receipt['id']}/cancel").status_code == 409
    assert counts(harness) == (1, 2, 1, 1)


def test_cancel_racing_reschedule_keeps_one_consistent_version(harness: Harness) -> None:
    owner, wid, data, _ = configured(harness)
    receipt = send(owner, wid, data).json()
    barrier = Barrier(2)

    def attempt(action: str) -> Any:
        barrier.wait()
        payload = (
            {"version": 1}
            if action == "cancel"
            else {**data, "version": 1, "starts_at": "2026-11-23T10:00:00Z"}
        )
        return send(owner, wid, payload, suffix=f"/{receipt['id']}/{action}")

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(attempt, ["cancel", "reschedule"]))
    assert sorted(r.status_code for r in responses) == [200, 409]
    winner = next(r.json() for r in responses if r.status_code == 200)
    assert winner["version"] == 2
    assert counts(harness) == (1, 0 if winner["status"] == "cancelled" else 2, 2, 2)


def test_configuration_change_racing_booking(harness: Harness) -> None:
    owner, wid, data, staff = configured(harness)
    barrier = Barrier(2)

    def attempt(action: str) -> Any:
        barrier.wait()
        if action == "book":
            return send(owner, wid, data)
        return harness.post(
            owner,
            f"/workspaces/{wid}/catalog/staff/{staff['id']}",
            {**staff["data"], "active": False},
            "PATCH",
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        booked, changed = list(pool.map(attempt, ["book", "edit"]))
    assert (booked.status_code, changed.status_code) in {(201, 409), (409, 200)}
    assert counts(harness) == ((1, 2, 1, 1) if booked.status_code == 201 else (0, 0, 0, 0))


@pytest.mark.parametrize("role,status", [("manager", 201), ("employee", 403), ("customer", 403)])
def test_booking_roles(harness: Harness, role: str, status: int) -> None:
    owner, wid, data, _ = configured(harness)
    other = harness.account("other@example.com")
    invite = harness.post(
        owner, f"/workspaces/{wid}/invitations", {"email": "other@example.com", "role": role}
    )
    assert invite.status_code == 201
    assert (
        harness.post(
            other, "/invitations/accept", {"token": harness.link("other@example.com", "invitation")}
        ).status_code
        == 200
    )
    result = send(other, wid, data)
    assert result.status_code == status, result.text


def test_calendar_range_filters_history_and_isolation(harness: Harness) -> None:
    owner, wid, data, _ = configured(harness)
    first = send(owner, wid, data).json()
    second = send(owner, wid, {**data, "starts_at": "2026-11-23T09:00:00Z"}).json()
    assert send(owner, wid, {"version": 1}, suffix=f"/{first['id']}/cancel").status_code == 200
    url = f"/api/v1/workspaces/{wid}/bookings"
    params = {
        "after": "2026-11-23T08:15:00Z",
        "before": "2026-11-23T09:00:00Z",
        "location_id": data["location_id"],
        "employee_id": first["slot"]["employee_id"],
        "resource_id": first["slot"]["resources"][0]["resource_id"],
        "status": "cancelled",
    }
    response = owner.get(url, params=params)
    assert response.status_code == 200, response.text
    assert [b["id"] for b in response.json()] == [first["id"]]
    assert owner.get(url, params={**params, "after": "2026-11-23T08:30:00Z"}).json() == []
    assert owner.get(url, params={**params, "resource_id": str(uuid4())}).json() == []
    params = {
        "after": "2026-11-23T09:00:00Z",
        "before": "2026-11-23T09:30:00Z",
        "status": "confirmed",
    }
    assert owner.get(url, params=params).json()[0]["id"] == second["id"]
    stranger = harness.account("calendar-stranger@example.com")
    assert stranger.get(url, params=params).status_code == 404
    for invalid in [
        {"after": "2026-11-23T00:00:00Z"},
        {"after": "2026-11-23T00:00:00", "before": "2026-11-24T00:00:00Z"},
        {"after": "2026-11-23T00:00:00Z", "before": "2027-11-24T00:00:00Z"},
        {"after": "2026-11-23T00:00:00Z", "before": "2026-11-22T00:00:00Z"},
    ]:
        assert owner.get(url, params=invalid).status_code == 422
