from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from slotwise.auth.dependencies import Current, Db, rate_limit
from slotwise.auth.models import now
from slotwise.business.models import BusinessProfile, Location
from slotwise.business.schemas import Policies
from slotwise.catalog.models import CatalogItem
from slotwise.core.errors import DomainError
from slotwise.scheduling.bookings import BookingService
from slotwise.scheduling.engine import SearchTooComplex, feasible_slots
from slotwise.scheduling.models import Appointment
from slotwise.scheduling.schemas import (
    AvailabilityQuery,
    BookingView,
    BookInput,
    CancelInput,
    RescheduleInput,
)
from slotwise.scheduling.service import SchedulingService
from slotwise.tenants.models import Workspace
from slotwise.tenants.service import TenantService

router = APIRouter(tags=["Customer booking"])
public = APIRouter(prefix="/public/{slug}", dependencies=[Depends(rate_limit)])


class PageSettings(BaseModel):
    enabled: bool
    version: int = Field(ge=0)


class CustomerBooking(BaseModel):
    id: UUID
    service_id: UUID
    location_id: UUID
    service_name: str
    customer_name: str
    starts_at: datetime
    ends_at: datetime
    status: str
    version: int
    price_minor: int
    currency: str

    @classmethod
    def receipt(cls, booking: BookingView) -> "CustomerBooking":
        return cls(
            **{
                key: getattr(booking, key)
                for key in cls.model_fields
                if key not in {"starts_at", "ends_at"}
            },
            starts_at=booking.slot.starts_at,
            ends_at=booking.slot.ends_at,
        )


async def workspace_by_slug(db: Db, slug: str, published: bool = True) -> Workspace:
    workspace = await db.scalar(
        select(Workspace).where(Workspace.slug == slug, Workspace.suspended.is_(False))
    )
    if workspace is None or (published and not workspace.public_booking_enabled):
        raise DomainError(404, "booking_page_unavailable", "This booking page is unavailable.")
    return workspace


class CustomerBookingService(BookingService):
    @property
    def customer_id(self) -> UUID:
        return self.current.user.id

    async def booking_access(self, workspace_id: UUID, appointment_id: UUID | None) -> Workspace:
        workspace = await self.db.scalar(
            select(Workspace)
            .where(Workspace.id == workspace_id, Workspace.suspended.is_(False))
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if workspace is None or (appointment_id is None and not workspace.public_booking_enabled):
            raise DomainError(404, "booking_page_unavailable", "This booking page is unavailable.")
        return workspace

    async def get(self, workspace_id: UUID, appointment_id: UUID) -> Appointment:
        row = await super().get(workspace_id, appointment_id)
        if row.customer_user_id != self.current.user.id:
            raise DomainError(404, "booking_not_found", "Booking not found.")
        return row


@router.get("/workspaces/{workspace_id}/booking-page", response_model=PageSettings)
async def page_settings(
    workspace_id: UUID, request: Request, db: Db, current: Current
) -> PageSettings:
    workspace, _ = await TenantService(db, request.app.state.settings, current).access(
        workspace_id, {"owner", "manager"}
    )
    return PageSettings(
        enabled=workspace.public_booking_enabled, version=workspace.public_booking_version
    )


@router.patch("/workspaces/{workspace_id}/booking-page", response_model=PageSettings)
async def save_page(
    workspace_id: UUID, data: PageSettings, request: Request, db: Db, current: Current
) -> PageSettings:
    service = TenantService(db, request.app.state.settings, current)
    workspace, _ = await service.access(workspace_id, {"owner"}, lock=True)
    if workspace.public_booking_version != data.version:
        raise DomainError(409, "stale_settings", "Booking page changed. Reload its settings.")
    workspace.public_booking_enabled = data.enabled
    workspace.public_booking_version += 1
    service.audit(
        workspace_id,
        "booking_page.publish" if data.enabled else "booking_page.disable",
        workspace_id,
    )
    await db.commit()
    return PageSettings(
        enabled=workspace.public_booking_enabled, version=workspace.public_booking_version
    )


@public.get("")
async def catalog(slug: str, request: Request, db: Db) -> dict[str, Any]:
    workspace = await workspace_by_slug(db, slug)
    profile = await db.get(BusinessProfile, workspace.id)
    policies = Policies.model_validate(profile.policies) if profile else Policies()
    locations = list(
        await db.scalars(
            select(Location)
            .where(Location.workspace_id == workspace.id, Location.active.is_(True))
            .order_by(Location.name)
        )
    )
    rows = list(
        await db.scalars(
            select(CatalogItem)
            .where(
                CatalogItem.workspace_id == workspace.id,
                CatalogItem.kind.in_(["services", "staff"]),
            )
            .order_by(CatalogItem.id)
        )
    )
    views = await SchedulingService(db, request.app.state.settings, None).views(workspace.id, rows)
    services, staff = [], []
    location_ids = {str(location.id) for location in locations}
    for row in views:
        data = row.data.model_dump(mode="json")
        if not data.get("active", True):
            continue
        if data["kind"] == "services":
            allowed = [
                str(value) for value in data.get("location_ids", []) if str(value) in location_ids
            ]
            if allowed:
                services.append(
                    {
                        "id": str(row.id),
                        **{
                            key: data[key]
                            for key in (
                                "name",
                                "description",
                                "duration_minutes",
                                "maximum_duration_minutes",
                                "duration_step_minutes",
                                "price_minor",
                                "currency",
                            )
                        },
                        "location_ids": allowed,
                    }
                )
        elif str(data.get("location_id")) in location_ids:
            staff.append(
                {"id": str(row.id), "name": data["name"], "location_id": str(data["location_id"])}
            )
    return {
        "name": workspace.name,
        "slug": workspace.slug,
        "cancellation": {
            "allowed": policies.cancellation_allowed,
            "notice_minutes": policies.cancellation_notice_minutes,
        },
        "locations": [
            {
                "id": str(location.id),
                "name": location.name,
                "address": location.address,
                "timezone": location.timezone,
            }
            for location in locations
        ],
        "services": services,
        "staff": staff,
    }


async def available(
    slug: str, query: AvailabilityQuery, request: Request, db: Db, current: Current | None = None
) -> dict[str, Any]:
    workspace = await workspace_by_slug(db, slug, published=query.exclude_booking_id is None)
    service = SchedulingService(db, request.app.state.settings, current)
    # Share the same guard as booking/configuration writers while collecting the snapshot.
    locked = await db.scalar(
        select(Workspace)
        .where(Workspace.id == workspace.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if (
        locked is None
        or locked.suspended
        or (query.exclude_booking_id is None and not locked.public_booking_enabled)
    ):
        raise DomainError(404, "booking_page_unavailable", "This booking page is unavailable.")
    if query.exclude_booking_id is not None:
        if current is None:
            raise DomainError(404, "booking_not_found", "Booking not found.")
        row = await CustomerBookingService(db, request.app.state.settings, current).get(
            workspace.id, query.exclude_booking_id
        )
        if row.status != "confirmed":
            raise DomainError(404, "booking_not_found", "Active booking not found.")
    snapshot = await service.snapshot(workspace.id, query, query.exclude_booking_id)
    await db.commit()
    try:
        result = feasible_slots(snapshot, query, now())
    except (ValueError, SearchTooComplex) as error:
        raise DomainError(422, "invalid_availability", "Choose another date or service.") from error
    return {
        "timezone": snapshot.location.timezone,
        "truncated": result.truncated,
        "slots": [{"starts_at": slot.starts_at, "ends_at": slot.ends_at} for slot in result.slots],
    }


@public.get("/availability")
async def public_availability(
    slug: str, query: Annotated[AvailabilityQuery, Query()], request: Request, db: Db
) -> dict[str, Any]:
    if query.exclude_booking_id is not None:
        raise DomainError(422, "invalid_availability", "Sign in to reschedule your appointment.")
    return await available(slug, query, request, db)


@public.get("/my-availability")
async def customer_availability(
    slug: str,
    query: Annotated[AvailabilityQuery, Query()],
    request: Request,
    db: Db,
    current: Current,
) -> dict[str, Any]:
    return await available(slug, query, request, db, current)


@public.get("/my-bookings", response_model=list[CustomerBooking])
async def history(
    slug: str,
    request: Request,
    db: Db,
    current: Current,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
) -> list[CustomerBooking]:
    service = CustomerBookingService(db, request.app.state.settings, current)
    workspace = await workspace_by_slug(db, slug, published=False)
    rows = await db.scalars(
        select(Appointment)
        .where(
            Appointment.workspace_id == workspace.id,
            Appointment.customer_user_id == current.user.id,
        )
        .order_by(Appointment.starts_at.desc(), Appointment.id)
        .offset(offset)
        .limit(limit)
    )
    return [CustomerBooking.receipt(service.booking_view(row)) for row in rows]


@public.post("/bookings", response_model=CustomerBooking, status_code=201)
async def book(
    slug: str,
    data: BookInput,
    request: Request,
    db: Db,
    current: Current,
    idempotency_key: Annotated[UUID, Header()],
) -> CustomerBooking:
    workspace = await workspace_by_slug(db, slug)
    receipt = await CustomerBookingService(db, request.app.state.settings, current).mutate(
        workspace.id, idempotency_key, data
    )
    return CustomerBooking.receipt(receipt)


@public.post("/bookings/{appointment_id}/reschedule", response_model=CustomerBooking)
async def reschedule(
    slug: str,
    appointment_id: UUID,
    data: RescheduleInput,
    request: Request,
    db: Db,
    current: Current,
    idempotency_key: Annotated[UUID, Header()],
) -> CustomerBooking:
    workspace = await workspace_by_slug(db, slug, published=False)
    receipt = await CustomerBookingService(db, request.app.state.settings, current).mutate(
        workspace.id, idempotency_key, data, appointment_id
    )
    return CustomerBooking.receipt(receipt)


@public.post("/bookings/{appointment_id}/cancel", response_model=CustomerBooking)
async def cancel(
    slug: str,
    appointment_id: UUID,
    data: CancelInput,
    request: Request,
    db: Db,
    current: Current,
    idempotency_key: Annotated[UUID, Header()],
) -> CustomerBooking:
    workspace = await workspace_by_slug(db, slug, published=False)
    receipt = await CustomerBookingService(db, request.app.state.settings, current).mutate(
        workspace.id, idempotency_key, data, appointment_id
    )
    return CustomerBooking.receipt(receipt)


router.include_router(public)
