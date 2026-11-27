import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import update
from test_booking_integration import configured
from test_identity_integration import Harness

from slotwise.auth.models import ActionToken, now

pytestmark = pytest.mark.skipif(
    os.getenv("SLOTWISE_INTEGRATION") != "1", reason="PostgreSQL required"
)


@pytest.fixture(autouse=True)
def freeze_time(monkeypatch: pytest.MonkeyPatch) -> None:
    for module in ("bookings", "service", "guards", "portal"):
        monkeypatch.setattr(
            f"slotwise.scheduling.{module}.now", lambda: datetime(2026, 11, 21, tzinfo=UTC)
        )


def setup(harness: Harness) -> tuple[Any, str, dict[str, Any], str]:
    owner, wid, data, _ = configured(harness)
    slug = owner.get("/api/v1/workspaces").json()[0]["slug"]
    assert owner.get(f"/api/v1/public/{slug}").status_code == 404
    assert (
        harness.post(
            owner, f"/workspaces/{wid}/booking-page", {"enabled": True, "version": 0}, "PATCH"
        ).status_code
        == 200
    )
    return owner, wid, data, slug


def guest(harness: Harness, slug: str, email: str) -> Any:
    client = harness.client()
    assert (
        harness.post(
            client, "/auth/booking-access", {"email": email, "name": "Guest Customer", "slug": slug}
        ).status_code
        == 202
    )
    token = harness.link(email, "booking access")
    response = harness.post(client, "/auth/booking-login", {"token": token})
    assert response.status_code == 200, response.text
    assert response.json()["verified"] is True
    assert harness.post(client, "/auth/booking-login", {"token": token}).status_code == 400
    return client


def submit(
    client: Any, slug: str, data: dict[str, Any], suffix: str = "", key: str | None = None
) -> Any:
    return client.post(
        f"/api/v1/public/{slug}/bookings{suffix}",
        json=data,
        headers={
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": client.cookies.get("sw_csrf", ""),
            "Idempotency-Key": key or str(uuid4()),
        },
    )


def test_public_projection_opt_in_and_customer_lifecycle(harness: Harness) -> None:
    owner, wid, data, slug = setup(harness)
    anonymous = harness.client()
    page = anonymous.get(f"/api/v1/public/{slug}")
    assert page.status_code == 200, page.text
    assert set(page.json()["staff"][0]) == {"id", "name", "location_id"}
    assert "requirements" not in page.json()["services"][0]
    params = {
        "service_id": data["service_id"],
        "location_id": data["location_id"],
        "start": "2026-11-23",
    }
    slots = anonymous.get(f"/api/v1/public/{slug}/availability", params=params).json()["slots"]
    assert slots and set(slots[0]) == {"starts_at", "ends_at"}
    assert submit(anonymous, slug, data).status_code == 401
    customer = guest(harness, slug, "guest@example.com")
    key = str(uuid4())
    booked = submit(customer, slug, data, key=key)
    assert booked.status_code == 201, booked.text
    booking = booked.json()
    assert "slot" not in booking and "employee_id" not in booking
    assert submit(customer, slug, data, key=key).json() == booking
    assert customer.get(f"/api/v1/workspaces/{wid}/bookings").status_code == 404
    assert customer.get(f"/api/v1/public/{slug}/my-bookings").json() == [booking]
    moved = submit(
        customer,
        slug,
        {**data, "version": 1, "starts_at": "2026-11-23T08:15:00Z"},
        f"/{booking['id']}/reschedule",
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["version"] == 2
    assert submit(customer, slug, {"version": 1}, f"/{booking['id']}/cancel").status_code == 409
    assert (
        harness.post(
            owner, f"/workspaces/{wid}/booking-page", {"enabled": False, "version": 1}, "PATCH"
        ).status_code
        == 200
    )
    assert anonymous.get(f"/api/v1/public/{slug}").status_code == 404
    assert submit(customer, slug, data).status_code == 404
    assert submit(customer, slug, {"version": 2}, f"/{booking['id']}/cancel").status_code == 200
    assert customer.get(f"/api/v1/public/{slug}/my-bookings").json()[0]["status"] == "cancelled"


def test_customer_ownership_preview_and_csrf(harness: Harness) -> None:
    owner, wid, data, slug = setup(harness)
    first = guest(harness, slug, "first@example.com")
    second = guest(harness, slug, "second@example.com")
    booking = submit(first, slug, data).json()
    assert second.get(f"/api/v1/public/{slug}/my-bookings").json() == []
    assert submit(second, slug, {"version": 1}, f"/{booking['id']}/cancel").status_code == 404
    params = {
        "service_id": data["service_id"],
        "location_id": data["location_id"],
        "start": "2026-11-23",
        "exclude_booking_id": booking["id"],
    }
    assert second.get(f"/api/v1/public/{slug}/my-availability", params=params).status_code == 404
    assert first.get(f"/api/v1/public/{slug}/my-availability", params=params).status_code == 200
    assert second.get(f"/api/v1/public/{slug}/availability", params=params).status_code == 422
    assert (
        first.post(
            f"/api/v1/public/{slug}/bookings/{booking['id']}/cancel",
            json={"version": 1},
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 403
    )
    assert (
        harness.post(
            second, f"/workspaces/{wid}/booking-page", {"enabled": True, "version": 1}, "PATCH"
        ).status_code
        == 404
    )


def test_guest_link_expiry_and_publication_conflicts(harness: Harness) -> None:
    owner, wid, _, slug = setup(harness)
    client = harness.client()
    assert (
        harness.post(
            client,
            "/auth/booking-access",
            {"email": "expired@example.com", "name": "Customer", "slug": slug},
        ).status_code
        == 202
    )
    raw = harness.link("expired@example.com", "booking access")

    async def expire() -> None:
        async with harness.factory() as db:
            await db.execute(update(ActionToken).values(expires_at=now() - timedelta(minutes=1)))
            await db.commit()

    asyncio.run(expire())
    assert harness.post(client, "/auth/booking-login", {"token": raw}).status_code == 400
    assert (
        harness.post(
            owner, f"/workspaces/{wid}/booking-page", {"enabled": False, "version": 0}, "PATCH"
        ).status_code
        == 409
    )
    assert client.get("/api/v1/public/unknown-business").status_code == 404


def test_customers_racing_for_one_slot_only_create_one_booking(harness: Harness) -> None:
    _, _, data, slug = setup(harness)
    first = guest(harness, slug, "race-first@example.com")
    second = guest(harness, slug, "race-second@example.com")
    barrier = Barrier(2)

    def book(client: Any) -> int:
        barrier.wait(timeout=10)
        return int(submit(client, slug, data).status_code)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(book, [first, second]))
    assert sorted(results) == [201, 409]
    assert (
        sum(
            len(client.get(f"/api/v1/public/{slug}/my-bookings").json())
            for client in [first, second]
        )
        == 1
    )
