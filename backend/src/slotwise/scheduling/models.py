"""Persistent bookings and exclusion-protected capacity allocations."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    UniqueConstraint,
    column,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column

from slotwise.auth.models import now
from slotwise.db.base import Base


class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (
        UniqueConstraint("workspace_id", "id"),
        ForeignKeyConstraint(
            ["workspace_id", "service_id", "service_kind"],
            ["catalog_items.workspace_id", "catalog_items.id", "catalog_items.kind"],
        ),
        ForeignKeyConstraint(
            ["workspace_id", "location_id"], ["locations.workspace_id", "locations.id"]
        ),
        CheckConstraint("service_kind = 'services'", name="service_kind"),
        CheckConstraint("status IN ('confirmed','cancelled')", name="status"),
        CheckConstraint("version > 0", name="version"),
        CheckConstraint("starts_at < ends_at", name="ordered"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    service_id: Mapped[UUID]
    service_kind: Mapped[str] = mapped_column(String(12), default="services")
    location_id: Mapped[UUID]
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    customer_name: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(12), default="confirmed")
    version: Mapped[int] = mapped_column(default=1)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    details: Mapped[dict[str, object]] = mapped_column(JSONB)


class Allocation(Base):
    __tablename__ = "allocations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "appointment_id"], ["appointments.workspace_id", "appointments.id"]
        ),
        ForeignKeyConstraint(
            ["workspace_id", "unit_id"], ["capacity_units.workspace_id", "capacity_units.id"]
        ),
        CheckConstraint("starts_at < ends_at", name="ordered"),
        ExcludeConstraint(
            ("unit_id", "="),
            (func.tstzrange(column("starts_at"), column("ends_at"), "[)"), "&&"),
            name="allocations_no_overlap",
            using="gist",
            ops={"unit_id": "public.gist_uuid_ops"},
        ),
    )
    workspace_id: Mapped[UUID] = mapped_column(primary_key=True)
    appointment_id: Mapped[UUID] = mapped_column(primary_key=True)
    unit_id: Mapped[UUID] = mapped_column(primary_key=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BookingRequest(Base):
    __tablename__ = "booking_requests"
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id"), primary_key=True)
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    key: Mapped[UUID] = mapped_column(primary_key=True)
    digest: Mapped[str] = mapped_column(String(64))
    receipt: Mapped[dict[str, object]] = mapped_column(JSONB)


class BookingEvent(Base):
    """Durable history/outbox; delivery is implemented in the notification phase."""

    __tablename__ = "booking_events"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "appointment_id"], ["appointments.workspace_id", "appointments.id"]
        ),
        UniqueConstraint("appointment_id", "version"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID]
    appointment_id: Mapped[UUID]
    version: Mapped[int]
    kind: Mapped[str] = mapped_column(String(30))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    payload: Mapped[dict[str, object]] = mapped_column(JSONB)
