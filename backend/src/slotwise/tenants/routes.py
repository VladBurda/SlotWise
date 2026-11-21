from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select

from slotwise.auth.dependencies import Current, Db, csrf
from slotwise.auth.models import User
from slotwise.auth.schemas import Message, TokenInput
from slotwise.core.errors import DomainError
from slotwise.tenants.models import Invitation, Membership, Workspace
from slotwise.tenants.schemas import (
    InviteInput,
    InviteView,
    MemberView,
    RoleInput,
    WorkspaceInput,
    WorkspaceView,
)
from slotwise.tenants.service import TenantService

router = APIRouter(tags=["Workspaces"])


@router.get("/workspaces", response_model=list[WorkspaceView])
async def list_workspaces(
    request: Request,
    db: Db,
    current: Current,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> list[WorkspaceView]:
    service = TenantService(db, request.app.state.settings, current)
    rows = await db.execute(
        select(Workspace, Membership.role)
        .join(Membership)
        .where(
            Membership.user_id == current.user.id,
            Workspace.suspended.is_(False),
        )
        .order_by(Workspace.created_at, Workspace.id)
        .offset(offset)
        .limit(limit)
    )
    return [service.view(workspace, role) for workspace, role in rows]


@router.post("/workspaces", response_model=WorkspaceView, status_code=201)
async def create_workspace(
    data: WorkspaceInput, request: Request, db: Db, current: Current
) -> WorkspaceView:
    return await TenantService(db, request.app.state.settings, current).create(data)


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceView)
async def get_workspace(
    workspace_id: UUID, request: Request, db: Db, current: Current
) -> WorkspaceView:
    service = TenantService(db, request.app.state.settings, current)
    workspace, member = await service.access(workspace_id)
    return service.view(workspace, member.role)


@router.get("/workspaces/{workspace_id}/members", response_model=list[MemberView])
async def members(
    workspace_id: UUID,
    request: Request,
    db: Db,
    current: Current,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> list[MemberView]:
    await TenantService(db, request.app.state.settings, current).access(
        workspace_id, {"owner", "manager"}
    )
    rows = await db.execute(
        select(User, Membership.role)
        .join(Membership)
        .where(
            Membership.workspace_id == workspace_id,
        )
        .order_by(User.name, User.id)
        .offset(offset)
        .limit(limit)
    )
    return [
        MemberView(user_id=user.id, name=user.name, email=user.email, role=role)
        for user, role in rows
    ]


@router.patch("/workspaces/{workspace_id}/members/{user_id}", response_model=Message)
async def change_role(
    workspace_id: UUID, user_id: UUID, data: RoleInput, request: Request, db: Db, current: Current
) -> Message:
    await TenantService(db, request.app.state.settings, current).change_member(
        workspace_id, user_id, data.role
    )
    return Message(message="Member role updated.")


@router.delete("/workspaces/{workspace_id}/members/{user_id}", response_model=Message)
async def remove_member(
    workspace_id: UUID, user_id: UUID, request: Request, db: Db, current: Current
) -> Message:
    await TenantService(db, request.app.state.settings, current).change_member(
        workspace_id, user_id, None
    )
    return Message(message="Member removed.")


@router.get("/workspaces/{workspace_id}/invitations", response_model=list[InviteView])
async def invitations(
    workspace_id: UUID,
    request: Request,
    db: Db,
    current: Current,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
) -> list[InviteView]:
    await TenantService(db, request.app.state.settings, current).access(workspace_id, {"owner"})
    rows = await db.scalars(
        select(Invitation)
        .where(Invitation.workspace_id == workspace_id)
        .order_by(Invitation.expires_at.desc(), Invitation.id)
        .offset(offset)
        .limit(limit)
    )
    return [InviteView.model_validate(item) for item in rows]


@router.post("/workspaces/{workspace_id}/invitations", response_model=InviteView, status_code=201)
async def invite(
    workspace_id: UUID, data: InviteInput, request: Request, db: Db, current: Current
) -> InviteView:
    invitation = await TenantService(db, request.app.state.settings, current).invite(
        workspace_id, data
    )
    return InviteView.model_validate(invitation)


@router.delete("/workspaces/{workspace_id}/invitations/{invitation_id}", response_model=Message)
async def revoke_invite(
    workspace_id: UUID, invitation_id: UUID, request: Request, db: Db, current: Current
) -> Message:
    service = TenantService(db, request.app.state.settings, current)
    await service.access(workspace_id, {"owner"}, lock=True)
    invitation = await db.scalar(
        select(Invitation).where(
            Invitation.workspace_id == workspace_id,
            Invitation.id == invitation_id,
        )
    )
    if invitation is None:
        raise DomainError(404, "invitation_not_found", "Invitation not found.")
    invitation.revoked = True
    service.audit(workspace_id, "invitation.revoke", invitation.id)
    await db.commit()
    return Message(message="Invitation revoked.")


@router.post("/invitations/accept", response_model=WorkspaceView, dependencies=[Depends(csrf)])
async def accept_invitation(
    data: TokenInput, request: Request, db: Db, current: Current
) -> WorkspaceView:
    return await TenantService(db, request.app.state.settings, current).accept(data.token)
