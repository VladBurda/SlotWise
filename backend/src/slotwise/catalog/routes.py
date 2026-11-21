from datetime import date
from uuid import UUID

from fastapi import APIRouter, Query, Request
from sqlalchemy import select

from slotwise.auth.dependencies import Current, Db
from slotwise.catalog.eligibility import configuration_matches
from slotwise.catalog.models import CatalogItem
from slotwise.catalog.schemas import CatalogInput, CatalogView, Kind, PreviewDay, ServiceInput
from slotwise.catalog.service import CatalogService
from slotwise.core.errors import DomainError

router = APIRouter(prefix="/workspaces/{workspace_id}/catalog", tags=["Scheduling configuration"])


@router.get("/{kind}", response_model=list[CatalogView])
async def list_items(
    workspace_id: UUID,
    kind: Kind,
    request: Request,
    db: Db,
    current: Current,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
) -> list[CatalogView]:
    return await CatalogService(db, request.app.state.settings, current).list_items(
        workspace_id, kind, offset, limit
    )


@router.post("/{kind}", response_model=CatalogView, status_code=201)
async def create_item(
    workspace_id: UUID,
    kind: Kind,
    data: CatalogInput,
    request: Request,
    db: Db,
    current: Current,
) -> CatalogView:
    return await CatalogService(db, request.app.state.settings, current).save(
        workspace_id, kind, None, data
    )


@router.patch("/{kind}/{item_id}", response_model=CatalogView)
async def update_item(
    workspace_id: UUID,
    kind: Kind,
    item_id: UUID,
    data: CatalogInput,
    request: Request,
    db: Db,
    current: Current,
) -> CatalogView:
    return await CatalogService(db, request.app.state.settings, current).save(
        workspace_id, kind, item_id, data
    )


@router.get("/{kind}/{item_id}/preview", response_model=list[PreviewDay])
async def preview(
    workspace_id: UUID,
    kind: Kind,
    item_id: UUID,
    start: date,
    request: Request,
    db: Db,
    current: Current,
    days: int = Query(7, ge=1, le=31),
) -> list[PreviewDay]:
    if not 1900 <= start.year <= 2100:
        raise DomainError(422, "invalid_date", "Preview dates must be between 1900 and 2100.")
    return await CatalogService(db, request.app.state.settings, current).preview_item(
        workspace_id, kind, item_id, start, days
    )


@router.get("/services/{item_id}/matches")
async def matches(
    workspace_id: UUID,
    item_id: UUID,
    location_id: UUID,
    on_date: date,
    request: Request,
    db: Db,
    current: Current,
) -> dict[str, object]:
    service = CatalogService(db, request.app.state.settings, current)
    await service.access(workspace_id, {"owner", "manager"}, lock=True)
    selected = (
        await service.views(workspace_id, [await service.item(workspace_id, "services", item_id)])
    )[0]
    assert isinstance(selected.data, ServiceInput)
    location = await service.location(workspace_id, location_id)
    if (
        not selected.data.active
        or not location.active
        or location_id not in selected.data.location_ids
    ):
        raise DomainError(
            422,
            "inactive_configuration",
            "Choose an active service and one of its active locations.",
        )
    rows = (
        await db.scalars(
            select(CatalogItem)
            .where(
                CatalogItem.workspace_id == workspace_id,
                CatalogItem.kind.in_(["staff", "skills", "resources", "pools"]),
            )
            .order_by(CatalogItem.name, CatalogItem.id)
        )
    ).all()
    return configuration_matches(
        selected.data, await service.views(workspace_id, rows), location_id, on_date
    )
