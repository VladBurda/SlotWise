from datetime import date
from uuid import UUID

from slotwise.catalog.schemas import CatalogView, PoolInput, ResourceInput, ServiceInput, StaffInput


def eligible_staff(
    service: ServiceInput,
    staff_id: UUID,
    staff: StaffInput,
    location_id: UUID,
    day: date,
    active_skills: set[UUID],
) -> bool:
    qualified = {
        q.skill_id
        for q in staff.qualifications
        if q.skill_id in active_skills and (q.valid_until is None or q.valid_until >= day)
    }
    return (
        service.active
        and staff.active
        and location_id in service.location_ids
        and staff.location_id == location_id
        and (not service.employee_ids or staff_id in service.employee_ids)
        and set(service.skill_ids) <= qualified
    )


def configuration_matches(
    service: ServiceInput,
    items: list[CatalogView],
    location_id: UUID,
    day: date,
) -> dict[str, object]:
    skills = {r.id for r in items if r.data.kind == "skills" and r.data.active}
    staff = [
        {"id": r.id, "name": r.data.name}
        for r in items
        if isinstance(r.data, StaffInput)
        and eligible_staff(service, r.id, r.data, location_id, day, skills)
    ]
    pools = {r.id: r.data for r in items if isinstance(r.data, PoolInput)}
    requirements: list[dict[str, object]] = []
    for requirement in service.requirements:
        pool = pools.get(requirement.pool_id) if requirement.pool_id else None
        candidates = [
            {"id": r.id, "name": r.data.name, "capacity": r.data.capacity}
            for r in items
            if isinstance(r.data, ResourceInput)
            and r.data.active
            and r.data.location_id == location_id
            and r.data.capacity >= requirement.units_per_resource
            and (not service.compatible_resource_ids or r.id in service.compatible_resource_ids)
            and (not requirement.resource_id or r.id == requirement.resource_id)
            and (not requirement.resource_type or r.data.resource_type == requirement.resource_type)
            and (
                not requirement.pool_id
                or (
                    pool is not None
                    and pool.active
                    and pool.location_id == location_id
                    and r.id in pool.resource_ids
                    and r.data.resource_type == pool.resource_type
                )
            )
        ]
        requirements.append(
            {
                "quantity": requirement.quantity,
                "units_per_resource": requirement.units_per_resource,
                "candidates": candidates,
                "enough_candidates": len(candidates) >= requirement.quantity,
            }
        )
    return {
        "staff": staff,
        "requirements": requirements,
        "notice": "Configuration matches only. Hours, shared resource combinations "
        "and existing bookings must be checked when booking.",
    }
