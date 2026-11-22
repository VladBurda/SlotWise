from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Request
from sqlalchemy import select

from slotwise.auth.dependencies import Current, Db
from slotwise.scheduling.bookings import BookingService
from slotwise.scheduling.models import Appointment
from slotwise.scheduling.schemas import (
    AvailabilityQuery,
    AvailabilityResult,
    BookingView,
    BookInput,
    CancelInput,
    RescheduleInput,
)
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


@router.post("/bookings", response_model=BookingView, status_code=201)
async def book(
    workspace_id: UUID,
    data: BookInput,
    request: Request,
    db: Db,
    current: Current,
    idempotency_key: Annotated[UUID, Header()],
) -> BookingView:
    return await BookingService(db, request.app.state.settings, current).mutate(
        workspace_id, idempotency_key, data
    )


@router.post("/bookings/{appointment_id}/reschedule", response_model=BookingView)
async def reschedule(
    workspace_id: UUID,
    appointment_id: UUID,
    data: RescheduleInput,
    request: Request,
    db: Db,
    current: Current,
    idempotency_key: Annotated[UUID, Header()],
) -> BookingView:
    return await BookingService(db, request.app.state.settings, current).mutate(
        workspace_id, idempotency_key, data, appointment_id
    )


@router.post("/bookings/{appointment_id}/cancel", response_model=BookingView)
async def cancel(
    workspace_id: UUID,
    appointment_id: UUID,
    data: CancelInput,
    request: Request,
    db: Db,
    current: Current,
    idempotency_key: Annotated[UUID, Header()],
) -> BookingView:
    return await BookingService(db, request.app.state.settings, current).mutate(
        workspace_id, idempotency_key, data, appointment_id
    )


@router.get("/bookings", response_model=list[BookingView])
async def bookings(
    workspace_id: UUID,
    request: Request,
    db: Db,
    current: Current,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
) -> list[BookingView]:
    service = BookingService(db, request.app.state.settings, current)
    await service.access(workspace_id, {"owner", "manager"})
    rows = await db.scalars(
        select(Appointment)
        .where(Appointment.workspace_id == workspace_id)
        .order_by(Appointment.starts_at, Appointment.id)
        .offset(offset)
        .limit(limit)
    )
    return [service.booking_view(row) for row in rows]
