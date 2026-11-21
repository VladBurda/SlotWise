from datetime import UTC, date, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from slotwise.business.schemas import LocationView
from slotwise.catalog.availability import operating_windows
from slotwise.catalog.eligibility import eligible_staff
from slotwise.catalog.schemas import (
    Availability,
    Qualification,
    Requirement,
    ServiceInput,
    StaffInput,
)


def location() -> LocationView:
    return LocationView.model_validate(
        {
            "id": str(uuid4()),
            "name": "Berlin",
            "timezone": "Europe/Berlin",
            "weekly": [{"weekday": day, "start": 0, "end": 1440} for day in range(7)],
        }
    )


@pytest.mark.parametrize("day,hours", [(date(2026, 3, 29), 3), (date(2026, 10, 25), 5)])
def test_schedule_uses_location_dst(day: date, hours: int) -> None:
    schedule = Availability.model_validate({"weekly": [{"weekday": 6, "start": 0, "end": 240}]})
    windows = operating_windows(day, location(), schedule)
    assert len(windows) == 1
    assert (windows[0][1] - windows[0][0]).total_seconds() == hours * 3600


def test_breaks_leave_and_business_hours_intersect() -> None:
    loc = location()
    loc.weekly = [loc.weekly[0].model_copy(update={"start": 540, "end": 1020})]
    schedule = Availability.model_validate(
        {
            "weekly": [{"weekday": 0, "start": 480, "end": 1080}],
            "breaks": [{"weekday": 0, "start": 720, "end": 780}],
            "unavailable": [
                {"start": "2026-11-23T14:00:00+01:00", "end": "2026-11-23T15:00:00+01:00"}
            ],
        }
    )
    windows = operating_windows(date(2026, 11, 23), loc, schedule)
    assert [(a.hour, b.hour) for a, b in windows] == [(8, 11), (12, 13), (14, 16)]
    assert all(a.tzinfo == UTC for a, _ in windows)


def test_exception_replaces_breaks_but_not_leave_or_business_closure() -> None:
    loc = location()
    data = {
        "weekly": [{"weekday": 0, "start": 540, "end": 1020}],
        "breaks": [{"weekday": 0, "start": 720, "end": 780}],
        "exceptions": [
            {"day": "2026-11-23", "kind": "special", "intervals": [{"start": 720, "end": 840}]}
        ],
    }
    schedule = Availability.model_validate(data)
    assert operating_windows(date(2026, 11, 23), loc, schedule) == [
        (
            datetime(2026, 11, 23, 11, tzinfo=UTC),
            datetime(2026, 11, 23, 13, tzinfo=UTC),
        )
    ]
    closed = LocationView.model_validate(
        {**loc.model_dump(), "exceptions": [{"day": "2026-11-23", "kind": "holiday"}]}
    )
    assert operating_windows(date(2026, 11, 23), closed, schedule) == []
    loc.active = False
    assert operating_windows(date(2026, 11, 23), loc, schedule) == []


@pytest.mark.parametrize(
    "data",
    [
        {"weekly": [{"weekday": 0, "start": 1200, "end": 60}]},
        {"breaks": [{"weekday": 0, "start": 600, "end": 660}]},
        {
            "weekly": [
                {"weekday": 0, "start": 60, "end": 180},
                {"weekday": 0, "start": 120, "end": 240},
            ]
        },
        {"unavailable": [{"start": "2026-11-23T09:00:00", "end": "2026-11-23T10:00:00"}]},
        {"unavailable": [{"start": "2026-11-23T10:00:00Z", "end": "2026-11-23T09:00:00Z"}]},
        {"exceptions": [{"day": "2026-11-23", "kind": "holiday"}] * 2},
    ],
)
def test_invalid_schedules(data: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        Availability.model_validate(data)


def test_qualification_expiry_active_skills_location_and_explicit_eligibility() -> None:
    loc, skill, staff_id = uuid4(), uuid4(), uuid4()
    service = ServiceInput(name="Diagnostic", location_ids=[loc], skill_ids=[skill])
    staff = StaffInput(
        name="Mechanic",
        location_id=loc,
        qualifications=[Qualification(skill_id=skill, valid_until=date(2026, 11, 23))],
    )
    assert eligible_staff(service, staff_id, staff, loc, date(2026, 11, 23), {skill})
    assert not eligible_staff(service, staff_id, staff, loc, date(2026, 11, 24), {skill})
    assert not eligible_staff(service, staff_id, staff, loc, date(2026, 11, 23), set())
    assert not eligible_staff(service, staff_id, staff, uuid4(), date(2026, 11, 23), {skill})
    service.employee_ids = [uuid4()]
    assert not eligible_staff(service, staff_id, staff, loc, date(2026, 11, 23), {skill})


@pytest.mark.parametrize(
    "data",
    [
        {},
        {"resource_id": str(uuid4()), "pool_id": str(uuid4())},
        {"resource_type": "room", "quantity": 0},
        {"resource_type": "room", "units_per_resource": True},
        {"resource_id": str(uuid4()), "quantity": 2},
    ],
)
def test_requirement_selector_and_capacity(data: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        Requirement.model_validate(data)


def test_variable_duration_and_duplicate_references() -> None:
    loc = uuid4()
    with pytest.raises(ValidationError):
        ServiceInput(
            name="Repair",
            location_ids=[loc],
            duration_minutes=30,
            maximum_duration_minutes=42,
            duration_step_minutes=5,
        )
    with pytest.raises(ValidationError):
        ServiceInput(name="Repair", location_ids=[loc, loc])
    assert (
        ServiceInput(
            name="Repair", location_ids=[loc], maximum_duration_minutes=60
        ).maximum_duration_minutes
        == 60
    )
