"""Deterministic scheduling over an explicit snapshot; no database or HTTP imports."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from itertools import combinations
from uuid import UUID
from zoneinfo import ZoneInfo

from slotwise.business.calendar import instants
from slotwise.business.schemas import LocationView, Policies
from slotwise.catalog.availability import Window, merge, operating_windows
from slotwise.catalog.eligibility import eligible_staff
from slotwise.catalog.schemas import (
    CatalogView,
    PoolInput,
    Requirement,
    ResourceInput,
    ServiceInput,
    StaffInput,
)
from slotwise.scheduling.schemas import AvailabilityQuery, ResourceAssignment, Slot


@dataclass(frozen=True)
class Unit:
    id: UUID
    item_id: UUID


@dataclass(frozen=True)
class Occupied:
    unit_id: UUID
    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        if self.start.utcoffset() is None or self.end.utcoffset() is None:
            raise ValueError("Occupancy requires ordered, timezone-aware instants")
        object.__setattr__(self, "start", self.start.astimezone(UTC))
        object.__setattr__(self, "end", self.end.astimezone(UTC))
        if self.start >= self.end:
            raise ValueError("Occupancy requires ordered, timezone-aware instants")


@dataclass(frozen=True)
class Snapshot:
    service: ServiceInput
    location: LocationView
    policies: Policies
    items: tuple[CatalogView, ...]
    units: tuple[Unit, ...]
    occupied: tuple[Occupied, ...]


@dataclass(frozen=True)
class SearchResult:
    slots: tuple[Slot, ...]
    truncated: bool
    warnings: tuple[str, ...]


class SearchTooComplex(Exception):
    """The search was not completed; never treat this as no availability."""


@dataclass
class Budget:
    remaining: int = 100_000

    def use(self) -> None:
        self.remaining -= 1
        if self.remaining < 0:
            raise SearchTooComplex(
                "Narrow the date range or simplify overlapping resource requirements."
            )


def resource_matches(
    service: ServiceInput,
    requirement: Requirement,
    resource_id: UUID,
    resource: ResourceInput,
    location_id: UUID,
    pools: dict[UUID, PoolInput],
) -> bool:
    pool = pools.get(requirement.pool_id) if requirement.pool_id else None
    return (
        resource.active
        and resource.location_id == location_id
        and (not service.compatible_resource_ids or resource_id in service.compatible_resource_ids)
        and (not requirement.resource_id or resource_id == requirement.resource_id)
        and (not requirement.resource_type or resource.resource_type == requirement.resource_type)
        and (
            not requirement.pool_id
            or (
                pool is not None
                and pool.active
                and pool.location_id == location_id
                and resource_id in pool.resource_ids
                and resource.resource_type == pool.resource_type
            )
        )
    )


def allocate(
    demands: list[tuple[Requirement, tuple[UUID, ...]]],
    free: dict[UUID, tuple[UUID, ...]],
    budget: Budget,
) -> tuple[ResourceAssignment, ...] | None:
    """Backtrack across assets; never reuse one capacity unit for two demands."""
    ordered = sorted(demands, key=lambda entry: (len(entry[1]) - entry[0].quantity, len(entry[1])))
    used: dict[UUID, int] = defaultdict(int)

    def visit(index: int) -> bool:
        budget.use()
        if index == len(ordered):
            return True
        requirement, candidates = ordered[index]
        eligible = [
            r
            for r in candidates
            if len(free.get(r, ())) - used[r] >= requirement.units_per_resource
        ]
        if len(eligible) < requirement.quantity:
            return False
        for selected in combinations(eligible, requirement.quantity):
            budget.use()
            for rid in selected:
                used[rid] += requirement.units_per_resource
            if visit(index + 1):
                return True
            for rid in selected:
                used[rid] -= requirement.units_per_resource
        return False

    if not visit(0):
        return None
    return tuple(
        ResourceAssignment(resource_id=rid, unit_ids=free[rid][:count])
        for rid, count in sorted(used.items())
        if count
    )


def feasible_slots(
    snapshot: Snapshot,
    query: AvailabilityQuery,
    now: datetime,
    *,
    budget: Budget | None = None,
    only_start: datetime | None = None,
) -> SearchResult:
    if now.utcoffset() is None:
        raise ValueError("Current time must be timezone-aware")
    now = now.astimezone(UTC)
    service, location, policies = snapshot.service, snapshot.location, snapshot.policies
    duration = (
        query.duration_minutes if query.duration_minutes is not None else service.duration_minutes
    )
    if (
        not service.duration_minutes <= duration <= service.maximum_duration_minutes
        or (duration - service.duration_minutes) % service.duration_step_minutes
    ):
        raise ValueError("Duration must be within the service range and follow its duration step")
    if query.location_id != location.id or location.id not in service.location_ids:
        raise ValueError("The service is not offered at this location")
    if not service.active or not location.active:
        return SearchResult((), False, ())
    budget = budget if budget is not None else Budget()
    zone = ZoneInfo(location.timezone)
    notice = service.minimum_notice_minutes
    earliest = now + timedelta(
        minutes=policies.minimum_notice_minutes if notice is None else notice
    )
    horizon = now + timedelta(days=policies.booking_horizon_days)
    before = timedelta(minutes=max(policies.buffer_before_minutes, service.buffer_before_minutes))
    after = timedelta(minutes=max(policies.buffer_after_minutes, service.buffer_after_minutes))
    elapsed = timedelta(minutes=duration)
    starts = sorted(
        {
            instant
            for offset in range(query.days)
            for minute in range(0, 1440, policies.slot_interval_minutes)
            for instant in instants(query.start + timedelta(days=offset), minute, location.timezone)
            if earliest <= instant
            and instant + elapsed <= horizon
            and (only_start is None or instant == only_start)
        }
    )
    if not starts:
        return SearchResult((), False, ())
    first_day = (starts[0] - before).astimezone(zone).date()
    last_day = (starts[-1] + elapsed + after).astimezone(zone).date()
    staff = {
        item.id: item.data
        for item in snapshot.items
        if isinstance(item.data, StaffInput)
        and item.data.active
        and item.data.location_id == location.id
        and (query.employee_id is None or query.employee_id == item.id)
    }
    resources = {
        item.id: item.data
        for item in snapshot.items
        if isinstance(item.data, ResourceInput)
        and item.data.active
        and item.data.location_id == location.id
    }
    pools = {item.id: item.data for item in snapshot.items if isinstance(item.data, PoolInput)}
    skills = {item.id for item in snapshot.items if item.data.kind == "skills" and item.data.active}
    demands = [
        (
            requirement,
            tuple(
                sorted(
                    rid
                    for rid, resource in resources.items()
                    if resource_matches(service, requirement, rid, resource, location.id, pools)
                )
            ),
        )
        for requirement in service.requirements
    ]
    windows: dict[UUID, list[Window]] = {}
    warnings: set[str] = set()
    scheduled: dict[UUID, StaffInput | ResourceInput] = {**staff, **resources}
    for item_id, item in scheduled.items():
        intervals: list[Window] = []
        for offset in range((last_day - first_day).days + 1):
            day = first_day + timedelta(days=offset)
            try:
                intervals.extend(operating_windows(day, location, item.availability))
            except ValueError as error:
                warnings.add(f"{item.name} ({item_id}), {day}: {error}")
        windows[item_id] = merge(intervals)
    units: dict[UUID, list[UUID]] = defaultdict(list)
    for unit in sorted(snapshot.units, key=lambda u: u.id):
        units[unit.item_id].append(unit.id)
    occupied: dict[UUID, list[Window]] = defaultdict(list)
    for block in snapshot.occupied:
        occupied[block.unit_id].append((block.start.astimezone(UTC), block.end.astimezone(UTC)))
    result: list[Slot] = []
    for start in starts:
        budget.use()
        end = start + elapsed
        left, right = start - before, end + after
        # A qualification must remain valid through the last occupied service date.
        qualification_day = (end - timedelta(microseconds=1)).astimezone(zone).date()
        free: dict[UUID, tuple[UUID, ...]] = {}
        for item_id, intervals in windows.items():
            if not any(a <= left and right <= b for a, b in intervals):
                continue
            free[item_id] = tuple(
                unit_id
                for unit_id in units[item_id]
                if not any(a < right and left < b for a, b in occupied[unit_id])
            )
        eligible = [
            employee_id
            for employee_id, employee in sorted(staff.items())
            if free.get(employee_id)
            and eligible_staff(
                service, employee_id, employee, location.id, qualification_day, skills
            )
        ]
        if not eligible:
            continue
        assigned = allocate(demands, free, budget)
        if assigned is None:
            continue
        if len(result) == query.limit:
            return SearchResult(tuple(result), True, tuple(sorted(warnings)))
        employee_id = eligible[0]
        result.append(
            Slot(
                starts_at=start,
                ends_at=end,
                occupied_from=left,
                occupied_until=right,
                employee_id=employee_id,
                employee_unit_id=free[employee_id][0],
                resources=assigned,
            )
        )
    return SearchResult(tuple(result), False, tuple(sorted(warnings)))
