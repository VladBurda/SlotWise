import hashlib
import json
from datetime import timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from slotwise.auth.models import now
from slotwise.business.models import BusinessProfile
from slotwise.business.schemas import Policies
from slotwise.catalog.models import CapacityUnit
from slotwise.core.errors import DomainError
from slotwise.scheduling.engine import SearchTooComplex, feasible_slots
from slotwise.scheduling.models import Allocation, Appointment, BookingEvent, BookingRequest
from slotwise.scheduling.schemas import (
    AvailabilityQuery,
    BookingView,
    BookInput,
    CancelInput,
    RescheduleInput,
    Slot,
)
from slotwise.scheduling.service import SchedulingService


class BookingService(SchedulingService):
    @staticmethod
    def booking_view(row: Appointment) -> BookingView:
        return BookingView.model_validate(
            {
                **row.details,
                "id": row.id,
                "service_id": row.service_id,
                "location_id": row.location_id,
                "customer_name": row.customer_name,
                "status": row.status,
                "version": row.version,
            }
        )

    async def get(self, workspace_id: UUID, appointment_id: UUID) -> Appointment:
        row = await self.db.scalar(
            select(Appointment)
            .where(
                Appointment.workspace_id == workspace_id,
                Appointment.id == appointment_id,
            )
            .with_for_update()
        )
        if row is None:
            raise DomainError(404, "booking_not_found", "Booking not found.")
        return row

    async def choose(
        self, workspace_id: UUID, data: BookInput, exclude: UUID | None
    ) -> tuple[Slot, dict[str, object]]:
        location = await self.location(workspace_id, data.location_id)
        day = data.starts_at.astimezone(ZoneInfo(location.timezone)).date()
        if not 1901 <= day.year <= 2099:
            raise DomainError(
                422, "invalid_booking", "Local booking dates must be between 1901 and 2099."
            )
        query = AvailabilityQuery(
            service_id=data.service_id,
            location_id=data.location_id,
            start=day,
            duration_minutes=data.duration_minutes,
            employee_id=data.employee_id,
            limit=500,
        )
        snapshot = await self.snapshot(workspace_id, query, exclude)
        # Narrow generation to the exact instant without weakening the grid or policy checks.
        try:
            result = feasible_slots(snapshot, query, now(), only_start=data.starts_at)
        except SearchTooComplex as error:
            raise DomainError(422, "search_too_complex", str(error)) from error
        except ValueError as error:
            raise DomainError(422, "invalid_booking", str(error)) from error
        if not result.slots:
            raise DomainError(409, "slot_unavailable", "This slot is no longer available.")
        slot = result.slots[0]
        ids = [slot.employee_unit_id, *(u for r in slot.resources for u in r.unit_ids)]
        locked = list(
            await self.db.scalars(
                select(CapacityUnit)
                .where(
                    CapacityUnit.workspace_id == workspace_id,
                    CapacityUnit.id.in_(ids),
                    CapacityUnit.active.is_(True),
                )
                .order_by(CapacityUnit.id)
                .with_for_update()
            )
        )
        if len(locked) != len(ids):
            raise DomainError(409, "slot_unavailable", "Capacity changed. Refresh availability.")
        return slot, {
            "slot": slot.model_dump(mode="json"),
            "service_name": snapshot.service.name,
            "price_minor": snapshot.service.price_minor,
            "currency": snapshot.service.currency,
        }

    async def mutate(
        self,
        workspace_id: UUID,
        key: UUID,
        data: BookInput | CancelInput,
        appointment_id: UUID | None = None,
    ) -> BookingView:
        try:
            return await self._mutate(workspace_id, key, data, appointment_id)
        except IntegrityError as error:
            await self.db.rollback()
            if getattr(error.orig, "sqlstate", None) == "23P01":
                raise DomainError(
                    409, "slot_unavailable", "Capacity was claimed. Refresh availability."
                ) from error
            raise
        except DBAPIError as error:
            await self.db.rollback()
            if getattr(error.orig, "sqlstate", None) in {"55P03", "40P01", "40001"}:
                raise DomainError(
                    503, "booking_busy", "Scheduling is busy. Retry with the same idempotency key."
                ) from error
            raise

    async def _mutate(
        self,
        workspace_id: UUID,
        key: UUID,
        data: BookInput | CancelInput,
        appointment_id: UUID | None,
    ) -> BookingView:
        await self.db.execute(text("SET LOCAL lock_timeout = '5s'"))
        workspace, _ = await self.access(workspace_id, {"owner", "manager"}, lock=True)
        action = (
            "cancel"
            if isinstance(data, CancelInput)
            else "reschedule"
            if appointment_id
            else "create"
        )
        digest = hashlib.sha256(
            json.dumps(
                {"action": action, "id": str(appointment_id), "data": data.model_dump(mode="json")},
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        previous = await self.db.get(BookingRequest, (workspace_id, self.current.user.id, key))
        if previous is not None:
            if previous.digest != digest:
                raise DomainError(
                    409, "idempotency_conflict", "This key was used for a different request."
                )
            return BookingView.model_validate(previous.receipt)
        row = await self.get(workspace_id, appointment_id) if appointment_id else None
        if row is not None:
            assert isinstance(data, (CancelInput, RescheduleInput))
            if row.version != data.version:
                raise DomainError(409, "stale_booking", "Booking changed. Reload before editing.")
            if row.status != "confirmed":
                raise DomainError(409, "booking_cancelled", "This booking is already cancelled.")
            profile = await self.db.get(BusinessProfile, workspace_id)
            policy = Policies.model_validate(profile.policies) if profile else Policies()
            if not policy.cancellation_allowed or row.starts_at < now() + timedelta(
                minutes=policy.cancellation_notice_minutes
            ):
                raise DomainError(
                    409, "cancellation_closed", "The cancellation/rescheduling window is closed."
                )
        if isinstance(data, CancelInput):
            assert row is not None
            row.status = "cancelled"
            row.version += 1
        else:
            slot, details = await self.choose(workspace_id, data, appointment_id)
            if row is None:
                row = Appointment(
                    id=uuid4(),
                    workspace_id=workspace_id,
                    created_by=self.current.user.id,
                    version=1,
                    status="confirmed",
                )
                self.db.add(row)
            else:
                row.version += 1
            row.service_id, row.location_id = data.service_id, data.location_id
            row.customer_name = data.customer_name
            row.starts_at, row.ends_at, row.details = slot.starts_at, slot.ends_at, details
        await self.db.flush()
        await self.db.execute(
            delete(Allocation).where(
                Allocation.workspace_id == workspace_id, Allocation.appointment_id == row.id
            )
        )
        if row.status == "confirmed":
            slot = Slot.model_validate(row.details["slot"])
            for unit_id in [
                slot.employee_unit_id,
                *(u for r in slot.resources for u in r.unit_ids),
            ]:
                self.db.add(
                    Allocation(
                        workspace_id=workspace_id,
                        appointment_id=row.id,
                        unit_id=unit_id,
                        starts_at=slot.occupied_from,
                        ends_at=slot.occupied_until,
                    )
                )
        receipt = self.booking_view(row)
        self.db.add(
            BookingRequest(
                workspace_id=workspace_id,
                actor_id=self.current.user.id,
                key=key,
                digest=digest,
                receipt=receipt.model_dump(mode="json"),
            )
        )
        self.db.add(
            BookingEvent(
                workspace_id=workspace_id,
                appointment_id=row.id,
                version=row.version,
                kind=f"booking.{action}",
                payload=receipt.model_dump(mode="json"),
            )
        )
        self.audit(workspace_id, f"booking.{action}", row.id)
        workspace.calendar_revision += 1
        await self.db.commit()
        return receipt
