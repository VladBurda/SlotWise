from datetime import date, datetime
from uuid import UUID

from pydantic import Field, field_validator

from slotwise.business.schemas import Input


class AvailabilityQuery(Input):
    service_id: UUID
    location_id: UUID
    start: date
    days: int = Field(default=1, ge=1, le=7)
    duration_minutes: int | None = Field(default=None, ge=5, le=1440)
    employee_id: UUID | None = None
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
    reservation_aware: bool = False
    notice: str = (
        "Configuration-only availability. Booking persistence is not implemented yet; "
        "these results do not reserve a slot."
    )
