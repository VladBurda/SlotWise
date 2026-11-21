from datetime import date
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, ForeignKey, ForeignKeyConstraint, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from slotwise.db.base import Base


class BusinessProfile(Base):
    __tablename__ = "business_profiles"
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id"), primary_key=True)
    version: Mapped[int] = mapped_column(default=1)
    description: Mapped[str] = mapped_column(String(2000), default="")
    contact_email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str] = mapped_column(String(50), default="")
    policies: Mapped[dict[str, int | bool]] = mapped_column(JSONB)


class Location(Base):
    __tablename__ = "locations"
    __table_args__ = (UniqueConstraint("workspace_id", "id"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    version: Mapped[int] = mapped_column(default=1)
    name: Mapped[str] = mapped_column(String(100))
    address: Mapped[str] = mapped_column(String(500))
    timezone: Mapped[str] = mapped_column(String(64))
    active: Mapped[bool] = mapped_column(default=True)


class OpeningRule(Base):
    __tablename__ = "opening_rules"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "location_id"], ["locations.workspace_id", "locations.id"]
        ),
        CheckConstraint("weekday BETWEEN 0 AND 6", name="weekday"),
        CheckConstraint("start >= 0 AND start < finish AND finish <= 1440", name="interval"),
    )
    workspace_id: Mapped[UUID] = mapped_column(primary_key=True)
    location_id: Mapped[UUID] = mapped_column(primary_key=True)
    weekday: Mapped[int] = mapped_column(primary_key=True)
    start: Mapped[int] = mapped_column(primary_key=True)
    finish: Mapped[int]


class OperatingException(Base):
    __tablename__ = "operating_exceptions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "location_id"], ["locations.workspace_id", "locations.id"]
        ),
        CheckConstraint("kind IN ('holiday', 'special')", name="kind"),
    )
    workspace_id: Mapped[UUID] = mapped_column(primary_key=True)
    location_id: Mapped[UUID] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(primary_key=True)
    kind: Mapped[Literal["holiday", "special"]] = mapped_column(String(10))
    label: Mapped[str] = mapped_column(String(100))


class ExceptionWindow(Base):
    __tablename__ = "exception_windows"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "location_id", "day"],
            [
                "operating_exceptions.workspace_id",
                "operating_exceptions.location_id",
                "operating_exceptions.day",
            ],
            ondelete="CASCADE",
        ),
        CheckConstraint("start >= 0 AND start < finish AND finish <= 1440", name="interval"),
    )
    workspace_id: Mapped[UUID] = mapped_column(primary_key=True)
    location_id: Mapped[UUID] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(primary_key=True)
    start: Mapped[int] = mapped_column(primary_key=True)
    finish: Mapped[int]
