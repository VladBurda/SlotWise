"""Explicit model registry for migrations and isolated test schemas."""

from slotwise.auth.models import ActionToken, RefreshToken, Session, User
from slotwise.business.models import (
    BusinessProfile,
    ExceptionWindow,
    Location,
    OpeningRule,
    OperatingException,
)
from slotwise.catalog.models import (
    CapacityUnit,
    CatalogItem,
    CatalogLink,
    ServiceLocation,
    ServiceRequirement,
)
from slotwise.notifications.models import AuthMail
from slotwise.scheduling.models import Allocation, Appointment, BookingEvent, BookingRequest
from slotwise.tenants.models import AuditLog, Invitation, Membership, Workspace

__all__ = [
    "Allocation",
    "Appointment",
    "BookingEvent",
    "BookingRequest",
    "CapacityUnit",
    "CatalogItem",
    "CatalogLink",
    "ServiceLocation",
    "ServiceRequirement",
    "BusinessProfile",
    "ExceptionWindow",
    "Location",
    "OpeningRule",
    "OperatingException",
    "ActionToken",
    "RefreshToken",
    "Session",
    "User",
    "AuthMail",
    "AuditLog",
    "Invitation",
    "Membership",
    "Workspace",
]
