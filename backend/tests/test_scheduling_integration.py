import os
from datetime import UTC, datetime

import pytest
from test_catalog_integration import create, setup
from test_identity_integration import Harness

pytestmark = pytest.mark.skipif(
    os.getenv("SLOTWISE_INTEGRATION") != "1", reason="PostgreSQL required"
)


def test_availability_snapshot_and_scope(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "slotwise.scheduling.service.now", lambda: datetime(2026, 11, 22, tzinfo=UTC)
    )
    owner, wid, loc = setup(harness)
    schedule = {
        "weekly": [{"weekday": 0, "start": 540, "end": 1020}],
        "breaks": [{"weekday": 0, "start": 720, "end": 780}],
    }
    staff = create(harness, owner, wid, "staff", location_id=loc, availability=schedule)
    resource = create(
        harness,
        owner,
        wid,
        "resources",
        location_id=loc,
        resource_type="bay",
        capacity=2,
        availability=schedule,
    )
    service = create(
        harness,
        owner,
        wid,
        "services",
        location_ids=[loc],
        buffer_before_minutes=15,
        buffer_after_minutes=15,
        requirements=[{"resource_id": resource["id"], "units_per_resource": 2}],
    )
    url = f"/api/v1/workspaces/{wid}/availability"
    params = {"service_id": service["id"], "location_id": loc, "start": "2026-11-23"}
    response = owner.get(url, params=params)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["reservation_aware"] is True
    assert not result["truncated"] and not result["warnings"]
    assert len(result["slots"]) == 22
    first = result["slots"][0]
    assert first["starts_at"] == "2026-11-23T08:15:00Z"
    assert first["employee_id"] == staff["id"]
    assert len(first["resources"][0]["unit_ids"]) == 2
    assert owner.get(url, params={**params, "duration_minutes": 35}).status_code == 422
    assert owner.get(url, params={**params, "days": 8}).status_code == 422
    stranger = harness.account("stranger@example.com")
    assert stranger.get(url, params=params).status_code == 404
    changed = harness.post(
        owner,
        f"/workspaces/{wid}/catalog/staff/{staff['id']}",
        {**staff["data"], "active": False},
        "PATCH",
    )
    assert changed.status_code == 200, changed.text
    assert owner.get(url, params=params).json()["slots"] == []


@pytest.mark.parametrize("role,status", [("manager", 200), ("employee", 403), ("customer", 403)])
def test_availability_roles(harness: Harness, role: str, status: int) -> None:
    owner, wid, loc = setup(harness)
    service = create(harness, owner, wid, "services", location_ids=[loc])
    other = harness.account("other@example.com")
    foreign = harness.workspace(other, "other")
    foreign_service = create(harness, other, foreign, "skills")
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
    url = f"/api/v1/workspaces/{wid}/availability"
    params = {"service_id": service["id"], "location_id": loc, "start": "2026-11-23"}
    assert other.get(url, params=params).status_code == status
    assert owner.get(url, params={**params, "service_id": foreign_service["id"]}).status_code == 404
