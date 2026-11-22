from uuid import UUID

from sqlalchemy import or_, select

from slotwise.auth.models import now
from slotwise.business.models import BusinessProfile
from slotwise.business.schemas import Policies
from slotwise.catalog.models import CapacityUnit, CatalogItem
from slotwise.catalog.schemas import ServiceInput
from slotwise.catalog.service import CatalogService
from slotwise.core.errors import DomainError
from slotwise.scheduling.engine import SearchTooComplex, Snapshot, Unit, feasible_slots
from slotwise.scheduling.schemas import AvailabilityQuery, AvailabilityResult


class SchedulingService(CatalogService):
    async def availability(
        self, workspace_id: UUID, query: AvailabilityQuery
    ) -> AvailabilityResult:
        # Configuration writers take this same lock; copy a coherent snapshot.
        await self.access(workspace_id, {"owner", "manager"}, lock=True)
        row = await self.item(workspace_id, "services", query.service_id)
        service = (await self.views(workspace_id, [row]))[0].data
        assert isinstance(service, ServiceInput)
        location = await self.location_view(await self.location(workspace_id, query.location_id))
        if query.employee_id is not None:
            await self.item(workspace_id, "staff", query.employee_id)
        profile = await self.db.get(BusinessProfile, workspace_id)
        policies = Policies.model_validate(profile.policies) if profile else Policies()
        rows = list(
            (
                await self.db.scalars(
                    select(CatalogItem).where(
                        CatalogItem.workspace_id == workspace_id,
                        or_(
                            CatalogItem.kind == "skills",
                            CatalogItem.location_id == query.location_id,
                        ),
                    )
                )
            ).all()
        )
        items = tuple(await self.views(workspace_id, rows))
        units = tuple(
            Unit(unit.id, unit.item_id)
            for unit in await self.db.scalars(
                select(CapacityUnit).where(
                    CapacityUnit.workspace_id == workspace_id,
                    CapacityUnit.active.is_(True),
                    CapacityUnit.item_id.in_([item.id for item in items]),
                )
            )
        )
        snapshot = Snapshot(service, location, policies, items, units, ())
        await self.db.commit()
        computed_at = now()
        try:
            result = feasible_slots(snapshot, query, computed_at)
        except SearchTooComplex as error:
            raise DomainError(422, "search_too_complex", str(error)) from error
        except ValueError as error:
            raise DomainError(422, "invalid_availability", str(error)) from error
        return AvailabilityResult(
            computed_at=computed_at,
            timezone=location.timezone,
            slots=result.slots,
            truncated=result.truncated,
            warnings=result.warnings,
        )
