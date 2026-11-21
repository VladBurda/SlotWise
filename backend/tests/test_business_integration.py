import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from test_identity_integration import Harness

from slotwise.business.models import OpeningRule

pytestmark = pytest.mark.skipif(
    os.getenv("SLOTWISE_INTEGRATION") != "1", reason="Real PostgreSQL required"
)


def location_data() -> dict[str, object]:
    return {
        "name": "Berlin",
        "timezone": "Europe/Berlin",
        "weekly": [{"weekday": 6, "start": 0, "end": 240}],
        "exceptions": [
            {"day": "2026-12-27", "kind": "holiday", "label": "Winter break"},
            {"day": "2026-12-20", "kind": "special", "intervals": [{"start": 600, "end": 720}]},
        ],
    }


def test_profile_location_persistence_preview_and_stale_saves(harness: Harness) -> None:
    owner = harness.account()
    wid = harness.workspace(owner)
    root = f"/workspaces/{wid}"
    profile = owner.get(f"/api/v1{root}/settings").json()
    assert profile["version"] == 0
    profile.update(name="Business renamed", contact_email="contact@example.com")
    saved = harness.post(owner, root + "/settings", profile, "PATCH")
    assert saved.status_code == 200, saved.text
    assert harness.post(owner, root + "/settings", profile, "PATCH").status_code == 409
    assert owner.get(f"/api/v1/workspaces/{wid}").json()["name"] == "Business renamed"
    response = harness.post(owner, root + "/locations", location_data())
    assert response.status_code == 201, response.text
    loc = response.json()
    path = root + "/locations/" + loc.pop("id")
    assert owner.get(f"/api/v1{root}/locations").json()[0]["exceptions"][0]["kind"] == "special"
    second = harness.post(
        owner,
        root + "/locations",
        {**location_data(), "name": "Kathmandu", "timezone": "Asia/Kathmandu"},
    )
    assert second.status_code == 201
    profile = saved.json()
    profile["timezone"] = "America/New_York"
    assert harness.post(owner, root + "/settings", profile, "PATCH").status_code == 200
    locations = owner.get(f"/api/v1{root}/locations").json()
    assert {item["timezone"] for item in locations} == {"Europe/Berlin", "Asia/Kathmandu"}
    assert owner.get(f"/api/v1{root}/locations?offset=1&limit=1").json()[0]["name"] == "Kathmandu"
    assert owner.get(f"/api/v1{path}/preview?start=2026-03-29&days=32").status_code == 422
    invalid = {**loc, "weekly": [{"weekday": 0, "start": 600, "end": 500}]}
    assert harness.post(owner, path, invalid, "PATCH").status_code == 422
    for day, expected in [("2026-03-29", 1), ("2026-12-27", 0), ("2026-12-20", 1)]:
        preview = owner.get(f"/api/v1{path}/preview?start={day}&days=1").json()[0]
        assert len(preview["intervals"]) == expected
    loc["active"] = False
    assert harness.post(owner, path, loc, "PATCH").status_code == 200
    assert harness.post(owner, path, loc, "PATCH").status_code == 409
    assert (
        owner.get(f"/api/v1{path}/preview?start=2026-03-29&days=1").json()[0]["source"]
        == "inactive"
    )


def test_dst_gap_requires_explicit_exception_and_rejects_bad_dated_boundary(
    harness: Harness,
) -> None:
    owner = harness.account()
    wid = harness.workspace(owner)
    root = f"/workspaces/{wid}/locations"
    data = {**location_data(), "weekly": [{"weekday": 6, "start": 150, "end": 240}]}
    loc = harness.post(owner, root, data).json()
    path = root + "/" + loc.pop("id")
    preview = owner.get(f"/api/v1{path}/preview?start=2026-03-29&days=1").json()[0]
    assert preview["issue"] and preview["intervals"] == []
    loc["exceptions"] = [
        {"day": "2026-03-29", "kind": "special", "intervals": [{"start": 150, "end": 240}]}
    ]
    assert harness.post(owner, path, loc, "PATCH").status_code == 422
    loc["exceptions"][0]["intervals"][0]["start"] = 180
    assert harness.post(owner, path, loc, "PATCH").status_code == 200
    assert owner.get(f"/api/v1{path}/preview?start=2026-03-29&days=1").json()[0]["issue"] is None


@pytest.mark.parametrize("role", ["manager", "employee", "customer"])
def test_permissions_and_tenant_boundaries(harness: Harness, role: str) -> None:
    owner = harness.account()
    wid = harness.workspace(owner)
    root = f"/workspaces/{wid}"
    loc = harness.post(owner, root + "/locations", location_data()).json()
    other = harness.account("other@example.com")
    other_wid = harness.workspace(other, "other-workspace")
    assert other.get(f"/api/v1{root}/settings").status_code == 404
    assert (
        harness.post(
            other, f"/workspaces/{other_wid}/locations/{loc['id']}", location_data(), "PATCH"
        ).status_code
        == 404
    )
    harness.post(owner, root + "/invitations", {"email": "other@example.com", "role": role})
    assert (
        harness.post(
            other, "/invitations/accept", {"token": harness.link("other@example.com", "invitation")}
        ).status_code
        == 200
    )
    assert other.get(f"/api/v1{root}/settings").status_code == (200 if role == "manager" else 403)
    assert harness.post(other, root + "/locations", location_data()).status_code == 403
    assert (
        harness.post(other, root + "/locations/" + loc["id"], location_data(), "PATCH").status_code
        == 403
    )
    profile = owner.get(f"/api/v1{root}/settings").json()
    assert harness.post(other, root + "/settings", profile, "PATCH").status_code == 403
    assert owner.patch(f"/api/v1{root}/settings", json=profile).status_code == 403

    async def cross_tenant_fk() -> None:
        async with harness.factory() as db:
            db.add(
                OpeningRule(
                    workspace_id=UUID(other_wid),
                    location_id=UUID(loc["id"]),
                    weekday=1,
                    start=0,
                    finish=60,
                )
            )
            with pytest.raises(IntegrityError):
                await db.commit()

    asyncio.run(cross_tenant_fk())


def test_concurrent_profile_writes_detect_stale_edit(harness: Harness) -> None:
    owner = harness.account()
    wid = harness.workspace(owner)
    path = f"/workspaces/{wid}/settings"
    data = owner.get("/api/v1" + path).json()
    clients = [harness.client(), harness.client()]
    for client in clients:
        client.cookies.update(owner.cookies)
    barrier = Barrier(2)

    def save(index: int) -> int:
        barrier.wait()
        return int(
            harness.post(clients[index], path, {**data, "name": str(uuid4())}, "PATCH").status_code
        )

    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(save, [0, 1])) == [200, 409]


def test_location_page_batches_schedules_without_mixing_locations(harness: Harness) -> None:
    owner = harness.account()
    wid = harness.workspace(owner)
    root = f"/workspaces/{wid}/locations"
    for index in range(3):
        response = harness.post(
            owner,
            root,
            {
                "name": f"Location {index}",
                "timezone": "UTC",
                "weekly": [{"weekday": index, "start": 60, "end": 120}],
                "exceptions": [
                    {
                        "day": "2026-12-20",
                        "kind": "special",
                        "label": str(index),
                        "intervals": [{"start": 600 + index * 60, "end": 660 + index * 60}],
                    }
                ],
            },
        )
        assert response.status_code == 201, response.text

    statements: list[str] = []

    def capture(
        connection: Any,
        cursor: Any,
        statement: str,
        parameters: Any,
        context: Any,
        executemany: bool,
    ) -> None:
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = harness.factory.kw["bind"].sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        single = owner.get(f"/api/v1{root}?limit=1")
        assert single.status_code == 200
        single_count = len(statements)
        statements.clear()
        page = owner.get(f"/api/v1{root}?limit=3")
        assert page.status_code == 200
        assert len(statements) == single_count
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    rows = page.json()
    assert len(rows) == 3
    for index, row in enumerate(rows):
        assert row["weekly"] == [{"weekday": index, "start": 60, "end": 120}]
        assert row["exceptions"][0]["label"] == str(index)
        assert row["exceptions"][0]["intervals"] == [
            {"start": 600 + index * 60, "end": 660 + index * 60}
        ]
    assert owner.get(f"/api/v1{root}?offset=3").json() == []
