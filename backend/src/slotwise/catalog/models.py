"""Versioned configuration entities with relational tenant-safe references."""

from datetime import date
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, ForeignKey, ForeignKeyConstraint, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from slotwise.db.base import Base


class CatalogItem(Base):
    __tablename__ = "catalog_items"
    __table_args__ = (
        UniqueConstraint("workspace_id", "id", "kind"),
        CheckConstraint("kind IN ('skills','staff','resources','pools','services')", name="kind"),
        CheckConstraint("version > 0", name="version"),
        ForeignKeyConstraint(
            ["workspace_id", "location_id"], ["locations.workspace_id", "locations.id"]
        ),
        CheckConstraint(
            "(kind IN ('staff','resources','pools') AND location_id IS NOT NULL) OR "
            "(kind IN ('skills','services') AND location_id IS NULL)",
            name="location_kind",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    kind: Mapped[str] = mapped_column(String(12))
    name: Mapped[str] = mapped_column(String(100))
    active: Mapped[bool]
    version: Mapped[int]
    location_id: Mapped[UUID | None]
    details: Mapped[dict[str, object]] = mapped_column(JSONB)


class CatalogLink(Base):
    __tablename__ = "catalog_links"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "source_id", "source_kind"],
            ["catalog_items.workspace_id", "catalog_items.id", "catalog_items.kind"],
            name="fk_catalog_links_source",
        ),
        ForeignKeyConstraint(
            ["workspace_id", "target_id", "target_kind"],
            ["catalog_items.workspace_id", "catalog_items.id", "catalog_items.kind"],
            name="fk_catalog_links_target",
        ),
        CheckConstraint(
            "(source_kind = 'staff' AND target_kind = 'skills') OR "
            "(source_kind = 'pools' AND target_kind = 'resources') OR "
            "(source_kind = 'services' AND target_kind IN ('staff','skills','resources'))",
            name="link_kinds",
        ),
    )
    workspace_id: Mapped[UUID] = mapped_column(primary_key=True)
    source_id: Mapped[UUID] = mapped_column(primary_key=True)
    target_id: Mapped[UUID] = mapped_column(primary_key=True)
    source_kind: Mapped[str] = mapped_column(String(12))
    target_kind: Mapped[str] = mapped_column(String(12))
    valid_until: Mapped[date | None]


class ServiceLocation(Base):
    __tablename__ = "service_locations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "service_id", "service_kind"],
            ["catalog_items.workspace_id", "catalog_items.id", "catalog_items.kind"],
        ),
        ForeignKeyConstraint(
            ["workspace_id", "location_id"], ["locations.workspace_id", "locations.id"]
        ),
        CheckConstraint("service_kind = 'services'", name="service_kind"),
    )
    workspace_id: Mapped[UUID] = mapped_column(primary_key=True)
    service_id: Mapped[UUID] = mapped_column(primary_key=True)
    location_id: Mapped[UUID] = mapped_column(primary_key=True)
    service_kind: Mapped[str] = mapped_column(String(12), default="services")


class ServiceRequirement(Base):
    __tablename__ = "service_requirements"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "service_id", "service_kind"],
            ["catalog_items.workspace_id", "catalog_items.id", "catalog_items.kind"],
            name="fk_service_requirements_service",
        ),
        ForeignKeyConstraint(
            ["workspace_id", "target_id", "target_kind"],
            ["catalog_items.workspace_id", "catalog_items.id", "catalog_items.kind"],
            name="fk_service_requirements_target",
        ),
        CheckConstraint("service_kind = 'services'", name="service_kind"),
        CheckConstraint(
            "(target_id IS NOT NULL AND target_kind IS NOT NULL "
            "AND target_kind IN ('resources','pools') "
            "AND resource_type IS NULL) OR (target_id IS NULL AND target_kind IS NULL "
            "AND resource_type IS NOT NULL)",
            name="selector",
        ),
        CheckConstraint("quantity BETWEEN 1 AND 100 AND units BETWEEN 1 AND 100", name="capacity"),
        CheckConstraint(
            "target_kind IS DISTINCT FROM 'resources' OR quantity = 1", name="specific"
        ),
    )
    workspace_id: Mapped[UUID] = mapped_column(primary_key=True)
    service_id: Mapped[UUID] = mapped_column(primary_key=True)
    position: Mapped[int] = mapped_column(primary_key=True)
    service_kind: Mapped[str] = mapped_column(String(12), default="services")
    target_id: Mapped[UUID | None]
    target_kind: Mapped[str | None] = mapped_column(String(12))
    resource_type: Mapped[str | None] = mapped_column(String(50))
    quantity: Mapped[int]
    units: Mapped[int]


class CapacityUnit(Base):
    __tablename__ = "capacity_units"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "item_id", "item_kind"],
            ["catalog_items.workspace_id", "catalog_items.id", "catalog_items.kind"],
        ),
        UniqueConstraint("workspace_id", "item_id", "number", name="uq_capacity_unit_number"),
        UniqueConstraint("workspace_id", "id", name="uq_capacity_unit_workspace_id"),
        CheckConstraint("item_kind IN ('staff','resources')", name="item_kind"),
        CheckConstraint("number BETWEEN 1 AND 100", name="number"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID]
    item_id: Mapped[UUID]
    item_kind: Mapped[str] = mapped_column(String(12))
    number: Mapped[int]
    active: Mapped[bool]
