from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

from slotwise.auth.schemas import EmailInput
from slotwise.tenants.models import Role


class WorkspaceInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    slug: str = Field(min_length=3, max_length=64, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    timezone: str = Field(default="UTC", max_length=64)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name must not be blank")
        return value.strip()

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError("Use a valid IANA time zone") from error
        return value


class WorkspaceView(BaseModel):
    id: UUID
    name: str
    slug: str
    timezone: str
    role: Role


class RoleInput(BaseModel):
    role: Role


class InviteInput(EmailInput, RoleInput):
    pass


class InviteView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: str
    role: Role
    expires_at: datetime
    accepted: bool
    revoked: bool


class MemberView(BaseModel):
    user_id: UUID
    name: str
    email: str
    role: Role
