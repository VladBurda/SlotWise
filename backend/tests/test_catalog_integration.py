import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from test_identity_integration import Harness

from slotwise.catalog.models import CapacityUnit, CatalogLink, ServiceRequirement

pytestmark = pytest.mark.skipif(
    os.getenv("SLOTWISE_INTEGRATION") != "1", reason="Real PostgreSQL required"
)


def setup(harness: Harness) -> tuple[Any, str, str]:
    owner = harness.account()
    wid = harness.workspace(owner)
    loc = harness.post(
        owner,
        f"/workspaces/{wid}/locations",
        {
            "name": "Workshop",
            "timezone": "Europe/Berlin",
            "weekly": [{"weekday": 0, "start": 540, "end": 1020}],
        },
    )
    assert loc.status_code == 201
    return owner, wid, loc.json()["id"]


def create(harness: Harness, owner: Any, wid: str, kind: str, **fields: Any) -> dict[str, Any]:
    response = harness.post(
        owner, f"/workspaces/{wid}/catalog/{kind}", {"kind": kind, "name": kind, **fields}
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


def test_catalog_roundtrip_matches_expiry_and_preview(harness: Harness) -> None:
    owner, wid, loc = setup(harness)
    skill = create(harness, owner, wid, "skills", name="Diagnostics")
    schedule = {
        "weekly": [{"weekday": 0, "start": 540, "end": 1020}],
        "breaks": [{"weekday": 0, "start": 720, "end": 780}],
    }
    staff = create(
        harness,
        owner,
        wid,
        "staff",
        name="Alex",
        location_id=loc,
        availability=schedule,
        qualifications=[{"skill_id": skill["id"], "valid_until": "2026-11-23"}],
    )
    resource = create(
        harness,
        owner,
        wid,
        "resources",
        name="Bay",
        location_id=loc,
        resource_type="bay",
        capacity=2,
        availability=schedule,
        attributes={"lift": "yes"},
    )
    pool = create(
        harness,
        owner,
        wid,
        "pools",
        location_id=loc,
        resource_type="bay",
        resource_ids=[resource["id"]],
    )
    service = create(
        harness,
        owner,
        wid,
        "services",
        name="Diagnostic",
        location_ids=[loc],
        skill_ids=[skill["id"]],
        employee_ids=[staff["id"]],
        compatible_resource_ids=[resource["id"]],
        requirements=[{"pool_id": pool["id"], "quantity": 1, "units_per_resource": 2}],
        maximum_duration_minutes=60,
        price_minor=5000,
    )
    root = f"/api/v1/workspaces/{wid}/catalog"
    for kind, expected in [
        ("skills", skill),
        ("staff", staff),
        ("resources", resource),
        ("pools", pool),
        ("services", service),
    ]:
        assert owner.get(f"{root}/{kind}").json() == [expected]
        assert owner.get(f"{root}/{kind}?offset=1").json() == []
    result = owner.get(
        f"{root}/services/{service['id']}/matches?location_id={loc}&on_date=2026-11-23"
    )
    assert result.status_code == 200, result.text
    assert result.json()["staff"] == [{"id": staff["id"], "name": "Alex"}]
    assert result.json()["requirements"][0]["enough_candidates"]
    assert (
        owner.get(
            f"{root}/services/{service['id']}/matches?location_id={loc}&on_date=2026-11-24"
        ).json()["staff"]
        == []
    )
    preview = owner.get(f"{root}/staff/{staff['id']}/preview?start=2026-11-23&days=1").json()
    assert len(preview[0]["intervals"]) == 2
    assert preview[0]["intervals"][0][0] == "2026-11-23T08:00:00Z"
    data = {**resource["data"], "active": False}
    assert (
        harness.post(
            owner, f"/workspaces/{wid}/catalog/resources/{resource['id']}", data, "PATCH"
        ).status_code
        == 200
    )
    assert not owner.get(
        f"{root}/services/{service['id']}/matches?location_id={loc}&on_date=2026-11-23"
    ).json()["requirements"][0]["enough_candidates"]


def test_tenant_references_and_database_constraints(harness: Harness) -> None:
    owner, wid, loc = setup(harness)
    outsider = harness.account("outsider@example.com")
    other_wid = harness.workspace(outsider, "outsider")
    skill = create(harness, outsider, other_wid, "skills")
    root = f"/workspaces/{wid}/catalog"
    assert outsider.get(f"/api/v1{root}/staff").status_code == 404
    assert (
        harness.post(
            owner,
            root + "/staff",
            {
                "kind": "staff",
                "name": "A",
                "location_id": loc,
                "qualifications": [{"skill_id": skill["id"]}],
            },
        ).status_code
        == 422
    )
    staff = create(harness, owner, wid, "staff", location_id=loc)
    assert (
        harness.post(
            outsider, f"/workspaces/{other_wid}/catalog/staff/{staff['id']}", staff["data"], "PATCH"
        ).status_code
        == 404
    )
    assert (
        harness.post(
            owner,
            root + "/resources",
            {
                "kind": "resources",
                "name": "Bad",
                "resource_type": "room",
                "location_id": str(uuid4()),
            },
        ).status_code
        == 422
    )

    async def invalid_fk() -> None:
        async with harness.factory() as db:
            db.add(
                CatalogLink(
                    workspace_id=UUID(wid),
                    source_id=UUID(staff["id"]),
                    source_kind="staff",
                    target_id=UUID(skill["id"]),
                    target_kind="skills",
                )
            )
            with pytest.raises(IntegrityError):
                await db.commit()

    asyncio.run(invalid_fk())


@pytest.mark.parametrize("role", ["manager", "employee", "customer"])
def test_catalog_permissions_and_csrf(harness: Harness, role: str) -> None:
    owner, wid, _ = setup(harness)
    member = harness.account("member@example.com")
    harness.post(
        owner, f"/workspaces/{wid}/invitations", {"email": "member@example.com", "role": role}
    )
    assert (
        harness.post(
            member,
            "/invitations/accept",
            {"token": harness.link("member@example.com", "invitation")},
        ).status_code
        == 200
    )
    root = f"/workspaces/{wid}/catalog/skills"
    assert member.get("/api/v1" + root).status_code == (200 if role == "manager" else 403)
    data = {"kind": "skills", "name": "Qualification"}
    assert harness.post(member, root, data).status_code == (201 if role == "manager" else 403)
    assert owner.post("/api/v1" + root, json=data).status_code == 403


def test_pool_location_type_capacity_and_stable_units(harness: Harness) -> None:
    owner, wid, loc = setup(harness)
    resource = create(
        harness, owner, wid, "resources", location_id=loc, resource_type="room", capacity=3
    )
    root = f"/workspaces/{wid}/catalog"
    assert (
        harness.post(
            owner,
            root + "/pools",
            {
                "kind": "pools",
                "name": "Bad",
                "location_id": loc,
                "resource_type": "bay",
                "resource_ids": [resource["id"]],
            },
        ).status_code
        == 422
    )
    assert (
        harness.post(
            owner,
            root + "/services",
            {
                "kind": "services",
                "name": "Bad",
                "location_ids": [loc],
                "requirements": [{"resource_id": resource["id"], "units_per_resource": 4}],
            },
        ).status_code
        == 422
    )

    async def units() -> dict[int, tuple[UUID, bool]]:
        async with harness.factory() as db:
            return {
                u.number: (u.id, u.active)
                for u in (
                    await db.scalars(
                        select(CapacityUnit).where(CapacityUnit.item_id == UUID(resource["id"]))
                    )
                )
            }

    original = asyncio.run(units())
    changed = harness.post(
        owner, root + "/resources/" + resource["id"], {**resource["data"], "capacity": 1}, "PATCH"
    )
    assert changed.status_code == 200
    reduced = asyncio.run(units())
    assert {n: row[0] for n, row in reduced.items()} == {n: row[0] for n, row in original.items()}
    assert [n for n, row in reduced.items() if row[1]] == [1]
    changed = harness.post(
        owner,
        root + "/resources/" + resource["id"],
        {**changed.json()["data"], "capacity": 3},
        "PATCH",
    )
    assert changed.status_code == 200
    assert asyncio.run(units()) == original
    create(
        harness,
        owner,
        wid,
        "pools",
        location_id=loc,
        resource_type="room",
        resource_ids=[resource["id"]],
    )
    assert (
        harness.post(
            owner,
            root + "/resources/" + resource["id"],
            {**changed.json()["data"], "resource_type": "bay"},
            "PATCH",
        ).status_code
        == 409
    )
    create(
        harness,
        owner,
        wid,
        "services",
        location_ids=[loc],
        requirements=[{"resource_id": resource["id"], "units_per_resource": 2}],
    )
    assert (
        harness.post(
            owner,
            root + "/resources/" + resource["id"],
            {**changed.json()["data"], "capacity": 1},
            "PATCH",
        ).status_code
        == 409
    )


def test_stale_concurrent_edits_and_kind_validation(harness: Harness) -> None:
    owner, wid, _ = setup(harness)
    skill = create(harness, owner, wid, "skills")
    path = f"/workspaces/{wid}/catalog/skills/{skill['id']}"
    clients = [harness.client(), harness.client()]
    for client in clients:
        client.cookies.update(owner.cookies)
    barrier = Barrier(2)

    def save(index: int) -> int:
        barrier.wait()
        return int(
            harness.post(
                clients[index], path, {**skill["data"], "name": str(index)}, "PATCH"
            ).status_code
        )

    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(save, [0, 1])) == [200, 409]
    assert harness.post(owner, f"/workspaces/{wid}/catalog/staff", skill["data"]).status_code == 422


def test_dst_invalid_exception_rolls_back_and_preview_reports_gap(harness: Harness) -> None:
    owner, wid, loc = setup(harness)
    staff = create(harness, owner, wid, "staff", location_id=loc)
    path = f"/workspaces/{wid}/catalog/staff/{staff['id']}"
    bad = {
        **staff["data"],
        "availability": {
            "exceptions": [
                {"day": "2026-03-29", "kind": "special", "intervals": [{"start": 150, "end": 240}]}
            ]
        },
    }
    assert harness.post(owner, path, bad, "PATCH").status_code == 422
    assert owner.get(f"/api/v1/workspaces/{wid}/catalog/staff").json() == [staff]


def test_requirement_database_rejects_missing_target_kind(harness: Harness) -> None:
    owner, wid, loc = setup(harness)
    service = create(harness, owner, wid, "services", location_ids=[loc])

    async def invalid_selector() -> None:
        async with harness.factory() as db:
            db.add(
                ServiceRequirement(
                    workspace_id=UUID(wid),
                    service_id=UUID(service["id"]),
                    position=0,
                    target_id=uuid4(),
                    target_kind=None,
                    resource_type=None,
                    quantity=1,
                    units=1,
                )
            )
            with pytest.raises(IntegrityError):
                await db.commit()

    asyncio.run(invalid_selector())
