from datetime import date
from uuid import UUID

from fastapi import APIRouter, Query, Request
from sqlalchemy import select

from slotwise.auth.dependencies import Current, Db
from slotwise.business.models import Location
from slotwise.business.schemas import LocationInput, LocationView, ProfileInput
from slotwise.business.service import BusinessService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["Business configuration"])


@router.get("/settings", response_model=ProfileInput)
async def profile(workspace_id: UUID, request: Request, db: Db, current: Current) -> ProfileInput:
    return await BusinessService(db, request.app.state.settings, current).profile(workspace_id)


@router.patch("/settings", response_model=ProfileInput)
async def save_profile(
    workspace_id: UUID, data: ProfileInput, request: Request, db: Db, current: Current
) -> ProfileInput:
    return await BusinessService(db, request.app.state.settings, current).save_profile(
        workspace_id, data
    )


@router.get("/locations", response_model=list[LocationView])
async def locations(
    workspace_id: UUID,
    request: Request,
    db: Db,
    current: Current,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
) -> list[LocationView]:
    service = BusinessService(db, request.app.state.settings, current)
    await service.access(workspace_id, {"owner", "manager"}, lock=True)
    rows = (
        await db.scalars(
            select(Location)
            .where(Location.workspace_id == workspace_id)
            .order_by(Location.name, Location.id)
            .offset(offset)
            .limit(limit)
        )
    ).all()
    return await service.location_views(workspace_id, rows)


@router.post("/locations", response_model=LocationView, status_code=201)
async def create_location(
    workspace_id: UUID, data: LocationInput, request: Request, db: Db, current: Current
) -> LocationView:
    return await BusinessService(db, request.app.state.settings, current).save_location(
        workspace_id, None, data
    )


@router.patch("/locations/{location_id}", response_model=LocationView)
async def save_location(
    workspace_id: UUID,
    location_id: UUID,
    data: LocationInput,
    request: Request,
    db: Db,
    current: Current,
) -> LocationView:
    return await BusinessService(db, request.app.state.settings, current).save_location(
        workspace_id, location_id, data
    )


@router.get("/locations/{location_id}/preview")
async def preview(
    workspace_id: UUID,
    location_id: UUID,
    start: date,
    request: Request,
    db: Db,
    current: Current,
    days: int = Query(7, ge=1, le=31),
) -> list[dict[str, object]]:
    if start.year < 1900 or start.year > 2100:
        from slotwise.core.errors import DomainError

        raise DomainError(422, "invalid_date", "Preview dates must be between 1900 and 2100.")
    return await BusinessService(db, request.app.state.settings, current).preview(
        workspace_id, location_id, start, days
    )
