from datetime import date
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from slotwise.tenants.schemas import WorkspaceInput


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Policies(Input):
    minimum_notice_minutes: int = Field(default=60, ge=0, le=525600)
    booking_horizon_days: int = Field(default=90, ge=1, le=365)
    cancellation_allowed: bool = True
    cancellation_notice_minutes: int = Field(default=1440, ge=0, le=525600)
    default_duration_minutes: int = Field(default=30, ge=5, le=1440)
    buffer_before_minutes: int = Field(default=0, ge=0, le=1440)
    buffer_after_minutes: int = Field(default=0, ge=0, le=1440)
    slot_interval_minutes: int = Field(default=15, ge=1, le=120)

    @model_validator(mode="after")
    def horizon(self) -> Self:
        if self.minimum_notice_minutes >= self.booking_horizon_days * 1440:
            raise ValueError("Minimum notice must be shorter than the booking horizon")
        return self


class ProfileInput(Input):
    version: int = Field(ge=0)
    name: str = Field(min_length=1, max_length=100)
    timezone: str = Field(max_length=64)
    description: str = Field(default="", max_length=2000)
    contact_email: EmailStr | None = None
    phone: str = Field(default="", max_length=50)
    policies: Policies = Field(default_factory=Policies)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        return WorkspaceInput.valid_timezone(value)


class Interval(Input):
    start: int = Field(ge=0, le=1439, strict=True)
    end: int = Field(ge=1, le=1440, strict=True)

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if self.start >= self.end:
            raise ValueError("Start must precede end; split overnight hours at midnight")
        return self


def validate_intervals(items: list[Interval]) -> None:
    ordered = sorted(items, key=lambda item: item.start)
    if any(a.end > b.start for a, b in zip(ordered, ordered[1:], strict=False)):
        raise ValueError("Operating intervals must not overlap")


class WeeklyInterval(Interval):
    weekday: int = Field(ge=0, le=6, strict=True)


class ExceptionInput(Input):
    day: date
    kind: Literal["holiday", "special"]
    label: str = Field(default="", max_length=100)
    intervals: list[Interval] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def valid(self) -> Self:
        if self.kind == "holiday" and self.intervals:
            raise ValueError("Holidays must have no operating intervals")
        if self.kind == "special" and not self.intervals:
            raise ValueError("Special hours require an interval; use a holiday to close the date")
        validate_intervals(self.intervals)
        return self


class LocationInput(Input):
    version: int = Field(default=0, ge=0)
    name: str = Field(min_length=1, max_length=100)
    address: str = Field(default="", max_length=500)
    timezone: str = Field(max_length=64)
    active: bool = True
    weekly: list[WeeklyInterval] = Field(default_factory=list, max_length=84)
    exceptions: list[ExceptionInput] = Field(default_factory=list, max_length=366)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        return WorkspaceInput.valid_timezone(value)

    @model_validator(mode="after")
    def schedule(self) -> Self:
        for weekday in range(7):
            validate_intervals([item for item in self.weekly if item.weekday == weekday])
        if len({item.day for item in self.exceptions}) != len(self.exceptions):
            raise ValueError("Only one exception is allowed per date")
        if any(item.day.year < 1900 or item.day.year > 2100 for item in self.exceptions):
            raise ValueError("Exception dates must be between 1900 and 2100")
        return self


class LocationView(LocationInput):
    id: UUID
