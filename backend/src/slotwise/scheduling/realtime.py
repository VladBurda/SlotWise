import asyncio
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from slotwise.auth.dependencies import identity
from slotwise.core.errors import DomainError
from slotwise.tenants.service import TenantService

router = APIRouter(prefix="/workspaces/{workspace_id}/calendar", tags=["Calendar"])
POLL_SECONDS = 2
STREAM_CHECKS = 25


async def read_revision(request: Request, workspace_id: UUID) -> int:
    # Fresh short sessions release the connection before waiting and observe revocation.
    async with request.app.state.sessions() as db:
        current = await identity(request, db)
        workspace, _ = await TenantService(db, request.app.state.settings, current).access(
            workspace_id, {"owner", "manager"}
        )
        return int(workspace.calendar_revision)


def check_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if (origin and origin not in request.app.state.settings.trusted_origins) or request.headers.get(
        "sec-fetch-site"
    ) == "cross-site":
        raise DomainError(403, "invalid_origin", "Calendar streams require a trusted origin.")


@router.get("/revision")
async def revision(request: Request, workspace_id: UUID) -> dict[str, str]:
    return {"revision": str(await read_revision(request, workspace_id))}


async def events(request: Request, workspace_id: UUID, previous: int) -> AsyncIterator[str]:
    # Every connection starts with a full-refresh signal. No event cursor can hide a
    # commit missed while offline, during a deployment, or between snapshot pages.
    yield f'event: ready\ndata: {{"revision":"{previous}"}}\n\n'
    for _ in range(STREAM_CHECKS):
        await asyncio.sleep(POLL_SECONDS)
        if await request.is_disconnected():
            return
        try:
            current = await read_revision(request, workspace_id)
        except DomainError as error:
            event = "expired" if error.status == 401 else "access-lost"
            yield f"event: {event}\ndata: {{}}\n\n"
            return
        if current != previous:
            yield f'event: changed\ndata: {{"revision":"{current}"}}\n\n'
            previous = current
        else:
            yield "event: heartbeat\ndata: {}\n\n"
    # Bound connection lifetime so cookies rotate and abandoned streams expire.
    yield "event: reconnect\ndata: {}\n\n"


@router.get("/events")
async def calendar_events(request: Request, workspace_id: UUID) -> StreamingResponse:
    check_origin(request)
    current = await read_revision(request, workspace_id)
    return StreamingResponse(
        events(request, workspace_id, current),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
