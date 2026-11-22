"""Conservative configuration protection while bookings need explicit resolution."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from slotwise.auth.models import now
from slotwise.core.errors import DomainError
from slotwise.scheduling.models import Appointment


async def protect_bookings(
    db: AsyncSession, workspace_id: UUID, location_id: UUID | None = None
) -> None:
    # Caller holds the workspace guard. Include in-progress bookings and their buffers.
    from slotwise.scheduling.models import Allocation

    query = (
        select(Appointment.id)
        .join(
            Allocation,
            (Allocation.workspace_id == Appointment.workspace_id)
            & (Allocation.appointment_id == Appointment.id),
        )
        .where(Appointment.workspace_id == workspace_id, Allocation.ends_at > now())
    )
    if location_id is not None:
        query = query.where(Appointment.location_id == location_id)
    if await db.scalar(query.limit(1)) is not None:
        raise DomainError(
            409,
            "bookings_require_resolution",
            "Resolve upcoming bookings before changing scheduling configuration.",
        )
