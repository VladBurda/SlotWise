"""Configuration contracts. Availability is civil time in the assigned location's zone."""

from datetime import UTC, date, datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, Field, RootModel, model_validator

from slotwise.business.schemas import ExceptionInput, Input, WeeklyInterval, validate_intervals


class Unavailable(Input):
    start: AwareDatetime
    end: AwareDatetime
    reason: str = Field(default="", max_length=200)

    @model_validator(mode="after")
    def ordered(self) -> Self:
        self.start = self.start.astimezone(UTC)
        self.end = self.end.astimezone(UTC)
        if self.start >= self.end:
            raise ValueError("Unavailable period must end after it starts")
        return self


class Availability(Input):
    weekly: list[WeeklyInterval] = Field(default_factory=list, max_length=84)
    breaks: list[WeeklyInterval] = Field(default_factory=list, max_length=84)
    exceptions: list[ExceptionInput] = Field(default_factory=list, max_length=366)
    unavailable: list[Unavailable] = Field(default_factory=list, max_length=366)

    @model_validator(mode="after")
    def valid(self) -> Self:
        for day in range(7):
            work = [w for w in self.weekly if w.weekday == day]
            breaks = [b for b in self.breaks if b.weekday == day]
            validate_intervals(work)
            validate_intervals(breaks)
            for pause in breaks:
                if not any(w.start <= pause.start < pause.end <= w.end for w in work):
                    raise ValueError("Each break must fit within a weekly working interval")
        if len({e.day for e in self.exceptions}) != len(self.exceptions):
            raise ValueError("Only one exception is allowed per date")
        if any(not 1900 <= e.day.year <= 2100 for e in self.exceptions):
            raise ValueError("Exception dates must be between 1900 and 2100")
        ordered = sorted(self.unavailable, key=lambda w: w.start)
        if any(a.end > b.start for a, b in zip(ordered, ordered[1:], strict=False)):
            raise ValueError("Unavailable periods must not overlap")
        return self


class Common(Input):
    version: int = Field(default=0, ge=0)
    name: str = Field(min_length=1, max_length=100)
    active: bool = True


class SkillInput(Common):
    kind: Literal["skills"] = "skills"
    description: str = Field(default="", max_length=2000)


class Qualification(Input):
    skill_id: UUID
    valid_until: date | None = None


class StaffInput(Common):
    kind: Literal["staff"] = "staff"
    location_id: UUID
    title: str = Field(default="", max_length=100)
    capacity: int = Field(default=1, ge=1, le=100, strict=True)
    qualifications: list[Qualification] = Field(default_factory=list, max_length=100)
    availability: Availability = Field(default_factory=Availability)

    @model_validator(mode="after")
    def unique_skills(self) -> Self:
        unique([q.skill_id for q in self.qualifications])
        return self


class ResourceInput(Common):
    kind: Literal["resources"] = "resources"
    location_id: UUID
    resource_type: str = Field(min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_-]*$")
    capacity: int = Field(default=1, ge=1, le=100, strict=True)
    attributes: dict[str, str] = Field(default_factory=dict, max_length=30)
    availability: Availability = Field(default_factory=Availability)

    @model_validator(mode="after")
    def bounded_attributes(self) -> Self:
        if any(not k.strip() or len(k) > 100 or len(v) > 500 for k, v in self.attributes.items()):
            raise ValueError(
                "Attributes need nonempty keys up to 100 and values up to 500 characters"
            )
        return self


def unique(values: list[UUID]) -> None:
    if len(set(values)) != len(values):
        raise ValueError("Duplicate selections are not allowed")


class PoolInput(Common):
    kind: Literal["pools"] = "pools"
    location_id: UUID
    resource_type: str = Field(min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_-]*$")
    resource_ids: list[UUID] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def unique_resources(self) -> Self:
        unique(self.resource_ids)
        return self


class Requirement(Input):
    resource_id: UUID | None = None
    pool_id: UUID | None = None
    resource_type: str | None = Field(default=None, max_length=50, pattern=r"^[a-z][a-z0-9_-]*$")
    quantity: int = Field(default=1, ge=1, le=100, strict=True)
    units_per_resource: int = Field(default=1, ge=1, le=100, strict=True)

    @model_validator(mode="after")
    def selector(self) -> Self:
        if sum(x is not None for x in (self.resource_id, self.pool_id, self.resource_type)) != 1:
            raise ValueError("Choose exactly one resource, pool or resource type")
        if self.resource_id and self.quantity != 1:
            raise ValueError("A specific resource has quantity one; use capacity units instead")
        return self


class ServiceInput(Common):
    kind: Literal["services"] = "services"
    description: str = Field(default="", max_length=2000)
    duration_minutes: int = Field(default=30, ge=5, le=1440, strict=True)
    maximum_duration_minutes: int = Field(default=30, ge=5, le=1440, strict=True)
    duration_step_minutes: int = Field(default=5, ge=1, le=120, strict=True)
    price_minor: int = Field(default=0, ge=0, le=100000000, strict=True)
    currency: Literal["EUR", "USD", "GBP", "CAD", "AUD", "CHF", "JPY", "UAH"] = "EUR"
    buffer_before_minutes: int = Field(default=0, ge=0, le=1440, strict=True)
    buffer_after_minutes: int = Field(default=0, ge=0, le=1440, strict=True)
    minimum_notice_minutes: int | None = Field(default=None, ge=0, le=525600, strict=True)
    location_ids: list[UUID] = Field(min_length=1, max_length=100)
    skill_ids: list[UUID] = Field(default_factory=list, max_length=100)
    employee_ids: list[UUID] = Field(default_factory=list, max_length=100)
    compatible_resource_ids: list[UUID] = Field(default_factory=list, max_length=100)
    requirements: list[Requirement] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def valid(self) -> Self:
        delta = self.maximum_duration_minutes - self.duration_minutes
        if delta < 0 or delta % self.duration_step_minutes:
            raise ValueError("Maximum duration must be minimum plus a whole number of steps")
        for values in (
            self.location_ids,
            self.skill_ids,
            self.employee_ids,
            self.compatible_resource_ids,
        ):
            unique(values)
        selectors = [(r.resource_id, r.pool_id, r.resource_type) for r in self.requirements]
        if len(set(selectors)) != len(selectors):
            raise ValueError("Combine duplicate resource requirements")
        return self


CatalogInput = Annotated[
    SkillInput | StaffInput | ResourceInput | PoolInput | ServiceInput,
    Field(discriminator="kind"),
]


class CatalogDocument(RootModel[CatalogInput]):
    pass


Kind = Literal["skills", "staff", "resources", "pools", "services"]


class CatalogView(Input):
    id: UUID
    data: CatalogInput


class PreviewDay(Input):
    day: date
    intervals: list[tuple[datetime, datetime]]
    issue: str | None = None
