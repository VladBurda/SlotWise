from datetime import timedelta
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from slotwise.auth.dependencies import Identity, require_verified
from slotwise.auth.models import User, now
from slotwise.auth.security import digest, token
from slotwise.core.config import Settings
from slotwise.core.errors import DomainError
from slotwise.notifications.mail import queue_mail
from slotwise.tenants.models import AuditLog, Invitation, Membership, Role, Workspace
from slotwise.tenants.schemas import InviteInput, WorkspaceInput, WorkspaceView


class TenantService:
    def __init__(self, db: AsyncSession, settings: Settings, current: Identity):
        self.db = db
        self.settings = settings
        self.current = current
        require_verified(current)

    def audit(self, workspace_id: UUID, action: str, object_id: UUID) -> None:
        self.db.add(
            AuditLog(
                workspace_id=workspace_id,
                actor_id=self.current.user.id,
                action=action,
                object_id=str(object_id),
            )
        )

    async def access(
        self, workspace_id: UUID, roles: set[str] | None = None, lock: bool = False
    ) -> tuple[Workspace, Membership]:
        query = select(Workspace).where(
            Workspace.id == workspace_id, Workspace.suspended.is_(False)
        )
        if lock:
            query = query.with_for_update()
        workspace = await self.db.scalar(query)
        membership = await self.db.get(
            Membership, (workspace_id, self.current.user.id), populate_existing=True
        )
        if workspace is None or membership is None:
            raise DomainError(404, "workspace_not_found", "Workspace not found.")
        if roles and membership.role not in roles:
            raise DomainError(403, "forbidden", "Your workspace role does not permit this action.")
        return workspace, membership

    @staticmethod
    def view(workspace: Workspace, role: Role) -> WorkspaceView:
        return WorkspaceView(
            id=workspace.id,
            name=workspace.name,
            slug=workspace.slug,
            timezone=workspace.timezone,
            role=role,
        )

    async def create(self, data: WorkspaceInput) -> WorkspaceView:
        workspace = Workspace(id=uuid4(), **data.model_dump())
        self.db.add(workspace)
        await self.db.flush()
        self.db.add(
            Membership(workspace_id=workspace.id, user_id=self.current.user.id, role="owner")
        )
        self.audit(workspace.id, "workspace.create", workspace.id)
        await self.db.commit()
        return self.view(workspace, "owner")

    async def invite(self, workspace_id: UUID, data: InviteInput) -> Invitation:
        workspace, _ = await self.access(workspace_id, {"owner"}, lock=True)
        existing = await self.db.scalar(
            select(Membership)
            .join(User)
            .where(
                Membership.workspace_id == workspace_id,
                User.email == str(data.email),
            )
        )
        if existing:
            raise DomainError(409, "already_member", "This person is already a workspace member.")
        previous = (
            await self.db.scalars(
                select(Invitation).where(
                    Invitation.workspace_id == workspace_id,
                    Invitation.email == str(data.email),
                    Invitation.accepted.is_(False),
                    Invitation.revoked.is_(False),
                )
            )
        ).all()
        for invitation in previous:
            invitation.revoked = True
        raw = token()
        invitation = Invitation(
            id=uuid4(),
            workspace_id=workspace_id,
            email=str(data.email),
            role=data.role,
            token_hash=digest(raw),
            expires_at=now() + timedelta(days=7),
        )
        self.db.add(invitation)
        link = f"{self.settings.public_url.rstrip('/')}/account/invite#token={raw}"
        queue_mail(
            self.db,
            self.settings,
            str(data.email),
            "Your SlotWise invitation",
            f"You have been invited to {workspace.name} as {data.role}.\n\n{link}\n\n"
            "Sign in with this email address to accept. This invitation expires in seven days.",
        )
        self.audit(workspace_id, "invitation.create", invitation.id)
        await self.db.commit()
        return invitation

    async def accept(self, raw: str) -> WorkspaceView:
        invitation = await self.db.scalar(
            select(Invitation).where(Invitation.token_hash == digest(raw))
        )
        if invitation is None:
            raise DomainError(400, "invalid_invitation", "Invitation is invalid or expired.")
        workspace = await self.db.scalar(
            select(Workspace)
            .where(
                Workspace.id == invitation.workspace_id,
                Workspace.suspended.is_(False),
            )
            .with_for_update()
        )
        await self.db.refresh(invitation)
        if (
            workspace is None
            or invitation.revoked
            or invitation.accepted
            or invitation.expires_at <= now()
        ):
            raise DomainError(400, "invalid_invitation", "Invitation is invalid or expired.")
        if invitation.email != self.current.user.email:
            raise DomainError(403, "wrong_recipient", "Sign in with the invited email address.")
        if await self.db.get(Membership, (workspace.id, self.current.user.id)):
            raise DomainError(409, "already_member", "You already belong to this workspace.")
        self.db.add(
            Membership(
                workspace_id=workspace.id, user_id=self.current.user.id, role=invitation.role
            )
        )
        invitation.accepted = True
        self.audit(workspace.id, "invitation.accept", invitation.id)
        await self.db.commit()
        return self.view(workspace, invitation.role)

    async def change_member(self, workspace_id: UUID, user_id: UUID, role: Role | None) -> None:
        await self.access(workspace_id, {"owner"}, lock=True)
        member = await self.db.get(Membership, (workspace_id, user_id), populate_existing=True)
        if member is None:
            raise DomainError(404, "member_not_found", "Member not found.")
        if member.role == "owner" and role != "owner":
            owners = await self.db.scalar(
                select(func.count())
                .select_from(Membership)
                .where(
                    Membership.workspace_id == workspace_id,
                    Membership.role == "owner",
                )
            )
            if owners == 1:
                raise DomainError(
                    409, "last_owner", "Add another owner before removing the last owner."
                )
        if role is None:
            await self.db.delete(member)
        else:
            member.role = role
        self.audit(
            workspace_id, "membership.remove" if role is None else "membership.role", user_id
        )
        await self.db.commit()
