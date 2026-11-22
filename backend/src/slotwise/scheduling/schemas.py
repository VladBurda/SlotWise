from datetime import UTC, date, datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, field_validator

from slotwise.business.schemas import Input


class AvailabilityQuery(Input):
    service_id: UUID
    location_id: UUID
    start: date
    days: int = Field(default=1, ge=1, le=7)
    duration_minutes: int | None = Field(default=None, ge=5, le=1440)
    employee_id: UUID | None = None
    exclude_booking_id: UUID | None = None
    limit: int = Field(default=100, ge=1, le=500)

    @field_validator("start")
    @classmethod
    def bounded_date(cls, value: date) -> date:
        if not 1901 <= value.year <= 2099:
            raise ValueError("Search dates must be between 1901 and 2099")
        return value


class ResourceAssignment(Input):
    resource_id: UUID
    unit_ids: tuple[UUID, ...]


class Slot(Input):
    starts_at: datetime
    ends_at: datetime
    occupied_from: datetime
    occupied_until: datetime
    employee_id: UUID
    employee_unit_id: UUID
    resources: tuple[ResourceAssignment, ...]


class AvailabilityResult(Input):
    computed_at: datetime
    timezone: str
    slots: tuple[Slot, ...]
    truncated: bool
    warnings: tuple[str, ...]
    reservation_aware: bool = True
    notice: str = "Availability includes committed bookings but does not reserve a slot."


class BookInput(Input):
    service_id: UUID
    location_id: UUID
    starts_at: AwareDatetime
    duration_minutes: int = Field(ge=5, le=1440)
    employee_id: UUID | None = None
    customer_name: str = Field(min_length=1, max_length=100)

    @field_validator("starts_at")
    @classmethod
    def utc_start(cls, value: datetime) -> datetime:
        value = value.astimezone(UTC)
        if not 1901 <= value.year <= 2099:
            raise ValueError("Booking dates must be between 1901 and 2099")
        return value


class RescheduleInput(BookInput):
    version: int = Field(ge=1)


class CancelInput(Input):
    version: int = Field(ge=1)


class BookingView(Input):
    id: UUID
    service_id: UUID
    location_id: UUID
    customer_name: str
    status: Literal["confirmed", "cancelled"]
    version: int
    slot: Slot
    service_name: str
    price_minor: int
    currency: str
