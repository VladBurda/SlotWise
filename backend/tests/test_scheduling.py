from dataclasses import replace
from datetime import UTC, date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest

from slotwise.business.schemas import ExceptionInput, LocationView, Policies, WeeklyInterval
from slotwise.catalog.schemas import (
    Availability,
    CatalogView,
    Qualification,
    Requirement,
    ResourceInput,
    ServiceInput,
    SkillInput,
    StaffInput,
    Unavailable,
)
from slotwise.scheduling.engine import (
    Budget,
    Occupied,
    SearchTooComplex,
    Snapshot,
    Unit,
    allocate,
    feasible_slots,
)
from slotwise.scheduling.schemas import AvailabilityQuery


def fixture(zone: str = "UTC") -> tuple[Snapshot, AvailabilityQuery]:
    weekly = [WeeklyInterval(weekday=d, start=0, end=1440) for d in range(7)]
    location = LocationView(id=UUID(int=1), name="Office", timezone=zone, weekly=weekly)
    staff = StaffInput(
        name="Alex", location_id=location.id, availability=Availability(weekly=weekly)
    )
    snapshot = Snapshot(
        ServiceInput(name="Visit", location_ids=[location.id]),
        location,
        Policies(minimum_notice_minutes=0),
        (CatalogView(id=UUID(int=2), data=staff),),
        (Unit(UUID(int=3), UUID(int=2)),),
        (),
    )
    query = AvailabilityQuery(
        service_id=UUID(int=4), location_id=location.id, start=date(2026, 11, 23), limit=500
    )
    return snapshot, query


NOW = datetime(2026, 11, 22, tzinfo=UTC)


def test_determinism_buffers_and_limit() -> None:
    snapshot, query = fixture()
    snapshot.service.buffer_before_minutes = 15
    snapshot.policies.buffer_before_minutes = 30
    result = feasible_slots(snapshot, query, NOW)
    assert result == feasible_slots(
        replace(snapshot, units=tuple(reversed(snapshot.units))), query, NOW
    )
    assert (result.slots[0].starts_at - result.slots[0].occupied_from).total_seconds() == 1800
    limited = feasible_slots(snapshot, query.model_copy(update={"limit": 2}), NOW)
    assert limited.slots == result.slots[:2] and limited.truncated


@pytest.mark.parametrize("day,count", [(date(2026, 3, 29), 92), (date(2026, 10, 25), 100)])
def test_dst_grid(day: date, count: int) -> None:
    snapshot, query = fixture("Europe/Berlin")
    query.start = day
    now = datetime(day.year, day.month, day.day, tzinfo=UTC).replace(day=day.day - 1)
    slots = feasible_slots(snapshot, query, now).slots
    assert len(slots) == count
    assert len({slot.starts_at for slot in slots}) == count
    assert all((slot.ends_at - slot.starts_at).total_seconds() == 1800 for slot in slots)


def test_non_hour_timezone_grid() -> None:
    snapshot, query = fixture("Asia/Kathmandu")
    snapshot.policies.slot_interval_minutes = 60
    slots = feasible_slots(snapshot, query, NOW).slots
    assert len(slots) == 24 and slots[0].starts_at.minute == 15


def test_occupancy_half_open_and_preferred_employee() -> None:
    snapshot, query = fixture()
    block = Occupied(
        UUID(int=3), datetime(2026, 11, 23, 10, tzinfo=UTC), datetime(2026, 11, 23, 11, tzinfo=UTC)
    )
    slots = feasible_slots(replace(snapshot, occupied=(block,)), query, NOW).slots
    starts = {s.starts_at for s in slots}
    assert datetime(2026, 11, 23, 9, 30, tzinfo=UTC) in starts
    assert datetime(2026, 11, 23, 9, 45, tzinfo=UTC) not in starts
    assert block.end in starts
    query.employee_id = UUID(int=99)
    assert not feasible_slots(snapshot, query, NOW).slots


def test_occupancy_fold_order() -> None:
    zone = ZoneInfo("Europe/Berlin")
    block = Occupied(
        UUID(int=3),
        datetime(2026, 10, 25, 2, 45, tzinfo=zone, fold=0),
        datetime(2026, 10, 25, 2, 15, tzinfo=zone, fold=1),
    )
    assert (block.end - block.start).total_seconds() == 1800


def test_joint_allocation_backtracks_and_does_not_reuse_units() -> None:
    a, b, c = (UUID(int=i) for i in (10, 11, 12))
    free = {a: (UUID(int=20),), b: (UUID(int=21),), c: (UUID(int=22),)}
    # First choice A,B prevents later A,C demand: must backtrack to B,C then A.
    demands = [
        (Requirement(resource_type="room", quantity=2), (a, b, c)),
        (Requirement(resource_type="desk"), (a, c)),
    ]
    assigned = allocate(demands, free, Budget())
    assert assigned is not None and len(assigned) == 3
    demands.append((Requirement(resource_id=a), (a,)))
    assert allocate(demands, free, Budget()) is None
    free[a] += (UUID(int=23),)
    assigned = allocate(demands, free, Budget())
    assert assigned is not None
    units = [u for r in assigned for u in r.unit_ids]
    assert len(units) == len(set(units)) == 4


def test_notice_duration_horizon_and_budget() -> None:
    snapshot, query = fixture()
    snapshot.policies.minimum_notice_minutes = 60
    now = datetime(2026, 11, 23, 9, tzinfo=UTC)
    assert feasible_slots(snapshot, query, now).slots[0].starts_at.hour == 10
    snapshot.service.minimum_notice_minutes = 0
    assert feasible_slots(snapshot, query, now).slots[0].starts_at.hour == 9
    snapshot.policies.booking_horizon_days = 1
    query.start = date(2026, 11, 25)
    assert not feasible_slots(snapshot, query, now).slots
    query.start = date(2026, 11, 23)
    with pytest.raises(SearchTooComplex):
        feasible_slots(snapshot, query, now, budget=Budget(1))
    query.duration_minutes = 35
    with pytest.raises(ValueError, match="Duration"):
        feasible_slots(snapshot, query, now)


def test_skill_expiry_at_midnight_and_closed_day() -> None:
    snapshot, query = fixture()
    skill_id = UUID(int=8)
    snapshot.service.skill_ids = [skill_id]
    employee = snapshot.items[0].data
    assert isinstance(employee, StaffInput)
    employee.qualifications = [Qualification(skill_id=skill_id, valid_until=query.start)]
    snapshot = replace(
        snapshot, items=(*snapshot.items, CatalogView(id=skill_id, data=SkillInput(name="Skill")))
    )
    slots = feasible_slots(snapshot, query, NOW).slots
    assert slots[-1].starts_at == datetime(2026, 11, 23, 23, 30, tzinfo=UTC)
    snapshot.location.exceptions = [ExceptionInput(day=query.start, kind="holiday")]
    assert not feasible_slots(snapshot, query, NOW).slots


def test_resource_maintenance_and_existing_unit_occupancy() -> None:
    snapshot, query = fixture()
    rid, uid = UUID(int=10), UUID(int=11)
    resource = ResourceInput(
        name="Room",
        location_id=query.location_id,
        resource_type="room",
        availability=Availability(
            weekly=snapshot.location.weekly,
            unavailable=[
                Unavailable(
                    start=datetime(2026, 11, 23, 10, tzinfo=UTC),
                    end=datetime(2026, 11, 23, 12, tzinfo=UTC),
                )
            ],
        ),
    )
    snapshot.service.requirements = [Requirement(resource_id=rid)]
    snapshot = replace(
        snapshot,
        items=(*snapshot.items, CatalogView(id=rid, data=resource)),
        units=(*snapshot.units, Unit(uid, rid)),
        occupied=(
            Occupied(
                uid, datetime(2026, 11, 23, 12, tzinfo=UTC), datetime(2026, 11, 23, 13, tzinfo=UTC)
            ),
        ),
    )
    slots = feasible_slots(snapshot, query, NOW).slots
    assert all(
        s.ends_at <= datetime(2026, 11, 23, 10, tzinfo=UTC)
        or s.starts_at >= datetime(2026, 11, 23, 13, tzinfo=UTC)
        for s in slots
    )
    assert any(s.starts_at.hour == 13 for s in slots)
    resource.active = False
    assert not feasible_slots(snapshot, query, NOW).slots


def test_nonexistent_work_boundary_returns_warning() -> None:
    snapshot, query = fixture("Europe/Berlin")
    query.start = date(2026, 3, 29)
    employee = snapshot.items[0].data
    assert isinstance(employee, StaffInput)
    employee.availability.weekly = [WeeklyInterval(weekday=6, start=150, end=240)]
    result = feasible_slots(snapshot, query, datetime(2026, 3, 28, tzinfo=UTC))
    assert not result.slots and result.warnings
