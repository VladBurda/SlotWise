from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request

from slotwise.auth.dependencies import Current, Db
from slotwise.scheduling.schemas import AvailabilityQuery, AvailabilityResult
from slotwise.scheduling.service import SchedulingService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["Availability"])


@router.get("/availability", response_model=AvailabilityResult)
async def availability(
    workspace_id: UUID,
    query: Annotated[AvailabilityQuery, Query()],
    request: Request,
    db: Db,
    current: Current,
) -> AvailabilityResult:
    return await SchedulingService(db, request.app.state.settings, current).availability(
        workspace_id, query
    )
