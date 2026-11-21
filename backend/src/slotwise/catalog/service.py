from collections import defaultdict
from collections.abc import Sequence
from datetime import date, timedelta
from uuid import UUID, uuid4

from sqlalchemy import delete, select

from slotwise.business.calendar import expand
from slotwise.business.models import Location
from slotwise.business.service import BusinessService
from slotwise.catalog.availability import operating_windows
from slotwise.catalog.models import (
    CapacityUnit,
    CatalogItem,
    CatalogLink,
    ServiceLocation,
    ServiceRequirement,
)
from slotwise.catalog.schemas import (
    CatalogDocument,
    CatalogInput,
    CatalogView,
    Kind,
    PoolInput,
    PreviewDay,
    ResourceInput,
    ServiceInput,
    StaffInput,
)
from slotwise.core.errors import DomainError


class CatalogService(BusinessService):
    async def item(self, workspace_id: UUID, kind: Kind, item_id: UUID) -> CatalogItem:
        row = await self.db.scalar(
            select(CatalogItem).where(
                CatalogItem.workspace_id == workspace_id,
                CatalogItem.kind == kind,
                CatalogItem.id == item_id,
            )
        )
        if row is None:
            raise DomainError(404, "item_not_found", "Configuration item not found.")
        return row

    async def views(self, workspace_id: UUID, rows: Sequence[CatalogItem]) -> list[CatalogView]:
        if not rows:
            return []
        ids = [r.id for r in rows]
        links = (
            await self.db.scalars(
                select(CatalogLink)
                .where(
                    CatalogLink.workspace_id == workspace_id,
                    CatalogLink.source_id.in_(ids),
                )
                .order_by(CatalogLink.target_id)
            )
        ).all()
        locations = (
            await self.db.scalars(
                select(ServiceLocation)
                .where(
                    ServiceLocation.workspace_id == workspace_id,
                    ServiceLocation.service_id.in_(ids),
                )
                .order_by(ServiceLocation.location_id)
            )
        ).all()
        requirements = (
            await self.db.scalars(
                select(ServiceRequirement)
                .where(
                    ServiceRequirement.workspace_id == workspace_id,
                    ServiceRequirement.service_id.in_(ids),
                )
                .order_by(ServiceRequirement.position)
            )
        ).all()
        by_source: dict[UUID, list[CatalogLink]] = defaultdict(list)
        by_service: dict[UUID, list[ServiceRequirement]] = defaultdict(list)
        location_ids: dict[UUID, list[UUID]] = defaultdict(list)
        for link in links:
            by_source[link.source_id].append(link)
        for requirement in requirements:
            by_service[requirement.service_id].append(requirement)
        for location in locations:
            location_ids[location.service_id].append(location.location_id)
        result: list[CatalogView] = []
        for row in rows:
            data: dict[str, object] = {
                **row.details,
                "kind": row.kind,
                "name": row.name,
                "active": row.active,
                "version": row.version,
            }
            if row.location_id:
                data["location_id"] = row.location_id
            refs = by_source[row.id]
            if row.kind == "staff":
                data["qualifications"] = [
                    {"skill_id": r.target_id, "valid_until": r.valid_until} for r in refs
                ]
            elif row.kind == "pools":
                data["resource_ids"] = [r.target_id for r in refs]
            elif row.kind == "services":
                data["location_ids"] = location_ids[row.id]
                for key, kind in (
                    ("skill_ids", "skills"),
                    ("employee_ids", "staff"),
                    ("compatible_resource_ids", "resources"),
                ):
                    data[key] = [r.target_id for r in refs if r.target_kind == kind]
                data["requirements"] = [
                    {
                        "resource_id": r.target_id if r.target_kind == "resources" else None,
                        "pool_id": r.target_id if r.target_kind == "pools" else None,
                        "resource_type": r.resource_type,
                        "quantity": r.quantity,
                        "units_per_resource": r.units,
                    }
                    for r in by_service[row.id]
                ]
            result.append(CatalogView(id=row.id, data=CatalogDocument.model_validate(data).root))
        return result

    async def list_items(
        self, workspace_id: UUID, kind: Kind, offset: int, limit: int
    ) -> list[CatalogView]:
        await self.access(workspace_id, {"owner", "manager"}, lock=True)
        rows = (
            await self.db.scalars(
                select(CatalogItem)
                .where(
                    CatalogItem.workspace_id == workspace_id,
                    CatalogItem.kind == kind,
                )
                .order_by(CatalogItem.name, CatalogItem.id)
                .offset(offset)
                .limit(limit)
            )
        ).all()
        return await self.views(workspace_id, rows)

    async def save(
        self, workspace_id: UUID, kind: Kind, item_id: UUID | None, data: CatalogInput
    ) -> CatalogView:
        await self.access(workspace_id, {"owner", "manager"}, lock=True)
        if data.kind != kind:
            raise DomainError(422, "wrong_kind", "The form does not match this collection.")
        row = await self.item(workspace_id, kind, item_id) if item_id else None
        self.check_version(row.version if row else 0, data.version)
        refs: list[tuple[UUID, str, date | None]] = []
        locations: list[UUID] = []
        if isinstance(data, (StaffInput, ResourceInput, PoolInput)):
            locations = [data.location_id]
        if isinstance(data, StaffInput):
            refs = [(q.skill_id, "skills", q.valid_until) for q in data.qualifications]
        if isinstance(data, PoolInput):
            refs = [(r, "resources", None) for r in data.resource_ids]
        if isinstance(data, ServiceInput):
            locations = data.location_ids
            refs.extend((r, "skills", None) for r in data.skill_ids)
            refs.extend((r, "staff", None) for r in data.employee_ids)
            refs.extend((r, "resources", None) for r in data.compatible_resource_ids)
        expected = {rid: target_kind for rid, target_kind, _ in refs}
        if isinstance(data, ServiceInput):
            for requirement in data.requirements:
                if requirement.resource_id:
                    expected[requirement.resource_id] = "resources"
                if requirement.pool_id:
                    expected[requirement.pool_id] = "pools"
        targets = (
            {
                r.id: r
                for r in (
                    await self.db.scalars(
                        select(CatalogItem).where(
                            CatalogItem.workspace_id == workspace_id,
                            CatalogItem.id.in_(expected),
                        )
                    )
                ).all()
            }
            if expected
            else {}
        )
        if any(rid not in targets or targets[rid].kind != k for rid, k in expected.items()) or any(
            rid not in targets or targets[rid].kind != k for rid, k, _ in refs
        ):
            raise DomainError(422, "invalid_reference", "Choose configuration from this workspace.")
        location_rows = (
            {
                r.id: r
                for r in (
                    await self.db.scalars(
                        select(Location).where(
                            Location.workspace_id == workspace_id,
                            Location.id.in_(locations),
                        )
                    )
                ).all()
            }
            if locations
            else {}
        )
        if set(location_rows) != set(locations):
            raise DomainError(422, "invalid_location", "Choose locations from this workspace.")
        if isinstance(data, PoolInput):
            if any(
                r.location_id != data.location_id
                or r.details["resource_type"] != data.resource_type
                for r in targets.values()
            ):
                raise DomainError(
                    422, "pool_mismatch", "Pool members must share its location and type."
                )
        if isinstance(data, ServiceInput):
            if any(r.location_id not in locations for r in targets.values() if r.kind != "skills"):
                raise DomainError(
                    422,
                    "location_mismatch",
                    "Selected staff and assets must be at a service location.",
                )
            for req in data.requirements:
                if req.resource_id and req.units_per_resource > int(
                    str(targets[req.resource_id].details["capacity"])
                ):
                    raise DomainError(
                        422, "capacity_exceeded", "Required units exceed resource capacity."
                    )
                target = (
                    targets[req.resource_id]
                    if req.resource_id
                    else targets[req.pool_id]
                    if req.pool_id
                    else None
                )
                if target and any(loc != target.location_id for loc in locations):
                    raise DomainError(
                        422,
                        "location_mismatch",
                        "A specific resource or pool must serve every selected location; "
                        "use a type for multiple locations.",
                    )
        if isinstance(data, (StaffInput, ResourceInput)):
            zone = location_rows[data.location_id].timezone
            for exception in data.availability.exceptions:
                for window in exception.intervals:
                    try:
                        expand(exception.day, window.start, window.end, zone)
                    except ValueError as error:
                        raise DomainError(422, "nonexistent_time", str(error)) from error
        if row and isinstance(data, (StaffInput, ResourceInput, PoolInput)):
            changed = row.location_id != data.location_id
            if isinstance(data, (ResourceInput, PoolInput)):
                changed |= row.details["resource_type"] != data.resource_type
            if changed:
                link = await self.db.scalar(
                    select(CatalogLink)
                    .where(
                        CatalogLink.workspace_id == workspace_id,
                        CatalogLink.target_id == row.id,
                    )
                    .limit(1)
                )
                req_row = await self.db.scalar(
                    select(ServiceRequirement)
                    .where(
                        ServiceRequirement.workspace_id == workspace_id,
                        ServiceRequirement.target_id == row.id,
                    )
                    .limit(1)
                )
                if link or req_row:
                    raise DomainError(
                        409,
                        "item_in_use",
                        "Remove dependent service or pool selections "
                        "before changing location or type.",
                    )
            if isinstance(data, ResourceInput):
                too_large = await self.db.scalar(
                    select(ServiceRequirement)
                    .where(
                        ServiceRequirement.workspace_id == workspace_id,
                        ServiceRequirement.target_id == row.id,
                        ServiceRequirement.units > data.capacity,
                    )
                    .limit(1)
                )
                if too_large:
                    raise DomainError(
                        409,
                        "capacity_in_use",
                        "A service requires more units; update its requirement first.",
                    )
        if row is None:
            row = CatalogItem(id=uuid4(), workspace_id=workspace_id, kind=kind)
            self.db.add(row)
        row.name, row.active, row.version = data.name, data.active, data.version + 1
        row.location_id = (
            data.location_id if isinstance(data, (StaffInput, ResourceInput, PoolInput)) else None
        )
        row.details = data.model_dump(
            mode="json",
            exclude={
                "kind",
                "name",
                "active",
                "version",
                "location_id",
                "qualifications",
                "resource_ids",
                "location_ids",
                "skill_ids",
                "employee_ids",
                "compatible_resource_ids",
                "requirements",
            },
        )
        await self.db.flush()
        await self.db.execute(
            delete(CatalogLink).where(
                CatalogLink.workspace_id == workspace_id,
                CatalogLink.source_id == row.id,
            )
        )
        for rid, target_kind, expiry in refs:
            self.db.add(
                CatalogLink(
                    workspace_id=workspace_id,
                    source_id=row.id,
                    source_kind=kind,
                    target_id=rid,
                    target_kind=target_kind,
                    valid_until=expiry,
                )
            )
        if isinstance(data, ServiceInput):
            for model in (ServiceLocation, ServiceRequirement):
                await self.db.execute(
                    delete(model).where(
                        model.workspace_id == workspace_id,
                        model.service_id == row.id,
                    )
                )
            for loc in locations:
                self.db.add(
                    ServiceLocation(workspace_id=workspace_id, service_id=row.id, location_id=loc)
                )
            for position, req in enumerate(data.requirements):
                self.db.add(
                    ServiceRequirement(
                        workspace_id=workspace_id,
                        service_id=row.id,
                        position=position,
                        target_id=req.resource_id or req.pool_id,
                        target_kind="resources"
                        if req.resource_id
                        else "pools"
                        if req.pool_id
                        else None,
                        resource_type=req.resource_type,
                        quantity=req.quantity,
                        units=req.units_per_resource,
                    )
                )
        if isinstance(data, (StaffInput, ResourceInput)):
            units = (
                await self.db.scalars(
                    select(CapacityUnit).where(
                        CapacityUnit.workspace_id == workspace_id,
                        CapacityUnit.item_id == row.id,
                    )
                )
            ).all()
            existing = {u.number for u in units}
            for unit in units:
                unit.active = data.active and unit.number <= data.capacity
            for number in range(1, data.capacity + 1):
                if number not in existing:
                    self.db.add(
                        CapacityUnit(
                            workspace_id=workspace_id,
                            item_id=row.id,
                            item_kind=kind,
                            number=number,
                            active=data.active,
                        )
                    )
        self.audit(workspace_id, f"catalog.{kind}.{'update' if item_id else 'create'}", row.id)
        await self.db.commit()
        return CatalogView(id=row.id, data=data.model_copy(update={"version": row.version}))

    async def preview_item(
        self, workspace_id: UUID, kind: Kind, item_id: UUID, start: date, days: int
    ) -> list[PreviewDay]:
        await self.access(workspace_id, {"owner", "manager"}, lock=True)
        item = (await self.views(workspace_id, [await self.item(workspace_id, kind, item_id)]))[0]
        if not isinstance(item.data, (StaffInput, ResourceInput)):
            raise DomainError(422, "no_schedule", "Only staff and resources have availability.")
        location = await self.location_view(
            await self.location(workspace_id, item.data.location_id)
        )
        result = []
        for offset in range(days):
            day = start + timedelta(days=offset)
            try:
                windows = (
                    operating_windows(day, location, item.data.availability)
                    if item.data.active
                    else []
                )
                result.append(PreviewDay(day=day, intervals=windows))
            except ValueError as error:
                result.append(PreviewDay(day=day, intervals=[], issue=str(error)))
        return result
