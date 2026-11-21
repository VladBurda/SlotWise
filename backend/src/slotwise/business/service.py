from collections import defaultdict
from collections.abc import Sequence
from datetime import date, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import delete, select

from slotwise.business.calendar import expand
from slotwise.business.models import (
    BusinessProfile,
    ExceptionWindow,
    Location,
    OpeningRule,
    OperatingException,
)
from slotwise.business.schemas import (
    ExceptionInput,
    Interval,
    LocationInput,
    LocationView,
    Policies,
    ProfileInput,
    WeeklyInterval,
)
from slotwise.core.errors import DomainError
from slotwise.tenants.service import TenantService


class BusinessService(TenantService):
    async def profile(self, workspace_id: UUID) -> ProfileInput:
        workspace, _ = await self.access(workspace_id, {"owner", "manager"}, lock=True)
        profile = await self.db.get(BusinessProfile, workspace_id)
        return ProfileInput(
            version=profile.version if profile else 0,
            name=workspace.name,
            timezone=workspace.timezone,
            description=profile.description if profile else "",
            contact_email=profile.contact_email if profile else None,
            phone=profile.phone if profile else "",
            policies=Policies.model_validate(profile.policies) if profile else Policies(),
        )

    async def save_profile(self, workspace_id: UUID, data: ProfileInput) -> ProfileInput:
        workspace, _ = await self.access(workspace_id, {"owner"}, lock=True)
        profile = await self.db.get(BusinessProfile, workspace_id)
        self.check_version(profile.version if profile else 0, data.version)
        if profile is None:
            profile = BusinessProfile(workspace_id=workspace_id)
            self.db.add(profile)
        workspace.name, workspace.timezone = data.name, data.timezone
        profile.description, profile.contact_email, profile.phone = (
            data.description,
            data.contact_email,
            data.phone,
        )
        profile.policies = data.policies.model_dump()
        profile.version = data.version + 1
        self.audit(workspace_id, "business.update", workspace_id)
        await self.db.commit()
        return data.model_copy(update={"version": profile.version})

    @staticmethod
    def check_version(actual: int, expected: int) -> None:
        if actual != expected:
            raise DomainError(
                409,
                "stale_settings",
                "Settings changed since you opened them. Reload before saving.",
            )

    async def location(self, workspace_id: UUID, location_id: UUID) -> Location:
        location = await self.db.scalar(
            select(Location).where(
                Location.workspace_id == workspace_id, Location.id == location_id
            )
        )
        if location is None:
            raise DomainError(404, "location_not_found", "Location not found.")
        return location

    async def location_view(self, location: Location) -> LocationView:
        return (await self.location_views(location.workspace_id, [location]))[0]

    async def location_views(
        self, workspace_id: UUID, locations: Sequence[Location]
    ) -> list[LocationView]:
        """Load a page's schedules in three tenant-scoped queries, regardless of page size."""
        if not locations:
            return []
        ids = [location.id for location in locations]
        weekly = (
            await self.db.scalars(
                select(OpeningRule)
                .where(OpeningRule.workspace_id == workspace_id, OpeningRule.location_id.in_(ids))
                .order_by(OpeningRule.weekday, OpeningRule.start)
            )
        ).all()
        exceptions = (
            await self.db.scalars(
                select(OperatingException)
                .where(
                    OperatingException.workspace_id == workspace_id,
                    OperatingException.location_id.in_(ids),
                )
                .order_by(OperatingException.day)
            )
        ).all()
        windows = (
            await self.db.scalars(
                select(ExceptionWindow)
                .where(
                    ExceptionWindow.workspace_id == workspace_id,
                    ExceptionWindow.location_id.in_(ids),
                )
                .order_by(ExceptionWindow.start)
            )
        ).all()
        weekly_by_location: dict[UUID, list[WeeklyInterval]] = defaultdict(list)
        windows_by_date: dict[tuple[UUID, date], list[Interval]] = defaultdict(list)
        exceptions_by_location: dict[UUID, list[ExceptionInput]] = defaultdict(list)
        for rule in weekly:
            weekly_by_location[rule.location_id].append(
                WeeklyInterval(weekday=rule.weekday, start=rule.start, end=rule.finish)
            )
        for window in windows:
            windows_by_date[window.location_id, window.day].append(
                Interval(start=window.start, end=window.finish)
            )
        for exception in exceptions:
            exceptions_by_location[exception.location_id].append(
                ExceptionInput(
                    day=exception.day,
                    kind=exception.kind,
                    label=exception.label,
                    intervals=windows_by_date[exception.location_id, exception.day],
                )
            )
        return [
            LocationView(
                id=location.id,
                version=location.version,
                name=location.name,
                address=location.address,
                timezone=location.timezone,
                active=location.active,
                weekly=weekly_by_location[location.id],
                exceptions=exceptions_by_location[location.id],
            )
            for location in locations
        ]

    async def save_location(
        self, workspace_id: UUID, location_id: UUID | None, data: LocationInput
    ) -> LocationView:
        await self.access(workspace_id, {"owner"}, lock=True)
        if location_id is None:
            self.check_version(0, data.version)
            location = Location(id=uuid4(), workspace_id=workspace_id)
            self.db.add(location)
        else:
            location = await self.location(workspace_id, location_id)
            self.check_version(location.version, data.version)
        for exception in data.exceptions:
            for interval in exception.intervals:
                try:
                    expand(exception.day, interval.start, interval.end, data.timezone)
                except ValueError as error:
                    raise DomainError(422, "nonexistent_time", str(error)) from error
        for key in ("name", "address", "timezone", "active"):
            setattr(location, key, getattr(data, key))
        location.version = data.version + 1
        await self.db.flush()
        for model in (ExceptionWindow, OperatingException, OpeningRule):
            await self.db.execute(
                delete(model).where(
                    model.workspace_id == workspace_id, model.location_id == location.id
                )
            )
        for rule in data.weekly:
            self.db.add(
                OpeningRule(
                    workspace_id=workspace_id,
                    location_id=location.id,
                    weekday=rule.weekday,
                    start=rule.start,
                    finish=rule.end,
                )
            )
        for exception in data.exceptions:
            self.db.add(
                OperatingException(
                    workspace_id=workspace_id,
                    location_id=location.id,
                    day=exception.day,
                    kind=exception.kind,
                    label=exception.label,
                )
            )
        await self.db.flush()
        for exception in data.exceptions:
            for window in exception.intervals:
                self.db.add(
                    ExceptionWindow(
                        workspace_id=workspace_id,
                        location_id=location.id,
                        day=exception.day,
                        start=window.start,
                        finish=window.end,
                    )
                )
        self.audit(
            workspace_id, "location.update" if location_id else "location.create", location.id
        )
        await self.db.commit()
        return LocationView(
            id=location.id, **data.model_copy(update={"version": location.version}).model_dump()
        )

    async def preview(
        self, workspace_id: UUID, location_id: UUID, start: date, days: int
    ) -> list[dict[str, object]]:
        await self.access(workspace_id, {"owner", "manager"}, lock=True)
        location = await self.location_view(await self.location(workspace_id, location_id))
        result: list[dict[str, object]] = []
        for offset in range(days):
            day = start + timedelta(days=offset)
            exception = next((e for e in location.exceptions if e.day == day), None)
            rules: list[Interval] = (
                list(exception.intervals)
                if exception
                else [r for r in location.weekly if r.weekday == day.weekday()]
            )
            intervals: list[dict[str, str]] = []
            issue = None
            if location.active:
                try:
                    expanded = sorted(expand(day, r.start, r.end, location.timezone) for r in rules)
                    # Adjacent civil windows can overlap after expanding both folds; union them.
                    merged: list[tuple[datetime, datetime]] = []
                    for a, b in expanded:
                        if merged and a <= merged[-1][1]:
                            merged[-1] = (merged[-1][0], max(b, merged[-1][1]))
                        else:
                            merged.append((a, b))
                    intervals = [{"start": a.isoformat(), "end": b.isoformat()} for a, b in merged]
                except ValueError as error:
                    issue = str(error)
            result.append(
                {
                    "day": day.isoformat(),
                    "source": "inactive"
                    if not location.active
                    else exception.kind
                    if exception
                    else "weekly",
                    "label": exception.label if exception else "",
                    "intervals": intervals,
                    "issue": issue,
                }
            )
        return result
