import asyncio
import hmac
from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from slotwise.auth.models import ActionToken, RefreshToken, Session, User, now
from slotwise.auth.schemas import RegisterInput
from slotwise.auth.security import DUMMY_HASH, digest, hasher, token, verify_password
from slotwise.core.config import Settings
from slotwise.core.errors import DomainError
from slotwise.notifications.mail import queue_mail
from slotwise.tenants.models import AuditLog


@dataclass
class Credentials:
    access: str
    refresh: str
    csrf: str
    remaining: int


class AuthService:
    def __init__(self, db: AsyncSession, settings: Settings):
        self.db = db
        self.settings = settings

    async def action(self, user: User, purpose: str) -> None:
        raw = token()
        self.db.add(
            ActionToken(
                token_hash=digest(raw),
                user_id=user.id,
                purpose=purpose,
                expires_at=now() + timedelta(hours=1),
            )
        )
        page = "verify" if purpose == "verify" else "reset"
        subject = (
            "Verify your SlotWise email" if purpose == "verify" else "Reset your SlotWise password"
        )
        # Fragment tokens are not sent in HTTP requests, proxy logs or Referer headers.
        link = f"{self.settings.public_url.rstrip('/')}/account/{page}#token={raw}"
        queue_mail(
            self.db,
            self.settings,
            user.email,
            subject,
            f"{subject}\n\n{link}\n\nThis link expires in one hour. "
            "If you did not request it, you can ignore this message.",
        )

    async def register(self, data: RegisterInput) -> None:
        encoded = await asyncio.to_thread(hasher.hash, data.password)
        user = await self.db.scalar(
            insert(User)
            .values(
                id=uuid4(),
                email=str(data.email),
                name=data.name,
                password_hash=encoded,
                verified=False,
                created_at=now(),
            )
            .on_conflict_do_nothing(index_elements=["email"])
            .returning(User)
        )
        if user is not None:
            await self.action(user, "verify")
            self.db.add(
                AuditLog(actor_id=user.id, action="account.register", object_id=str(user.id))
            )
        await self.db.commit()

    async def request_action(self, email: str, purpose: str) -> None:
        user = await self.db.scalar(select(User).where(User.email == email).with_for_update())
        if user is not None and (purpose != "verify" or not user.verified):
            await self.action(user, purpose)
        await self.db.commit()

    async def credentials(self, session: Session, csrf_value: str) -> Credentials:
        access, refresh = token(), token()
        session.access_hash = digest(access)
        session.csrf_hash = digest(csrf_value)
        session.access_expires = min(
            now() + timedelta(seconds=self.settings.access_seconds),
            session.expires_at,
        )
        return Credentials(
            access, refresh, csrf_value, max(0, int((session.expires_at - now()).total_seconds()))
        )

    async def login(self, email: str, password: str) -> tuple[User, Credentials]:
        user = await self.db.scalar(select(User).where(User.email == email).with_for_update())
        valid = await asyncio.to_thread(
            verify_password,
            user.password_hash if user else DUMMY_HASH,
            password,
        )
        if user is None or not valid:
            raise DomainError(401, "invalid_credentials", "Email or password is incorrect.")
        if hasher.check_needs_rehash(user.password_hash):
            user.password_hash = await asyncio.to_thread(hasher.hash, password)
        session = Session(
            id=uuid4(),
            user_id=user.id,
            expires_at=now() + timedelta(seconds=self.settings.session_seconds),
        )
        credentials = await self.credentials(session, token())
        self.db.add(session)
        # Explicit flush orders session before its refresh token without ORM relationships.
        await self.db.flush()
        self.db.add(RefreshToken(token_hash=digest(credentials.refresh), session_id=session.id))
        self.db.add(AuditLog(actor_id=user.id, action="session.login", object_id=str(session.id)))
        await self.db.commit()
        return user, credentials

    async def refresh(self, raw: str, csrf_value: str) -> Credentials:
        old = await self.db.get(RefreshToken, digest(raw))
        session = await self.db.get(Session, old.session_id) if old else None
        if old is None or session is None:
            raise DomainError(401, "invalid_session", "Please sign in again.")
        # All session writers lock user, then session; resets use the same order.
        await self.db.scalar(select(User).where(User.id == session.user_id).with_for_update())
        session = await self.db.scalar(
            select(Session)
            .where(Session.id == session.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        old = await self.db.scalar(
            select(RefreshToken)
            .where(RefreshToken.token_hash == digest(raw))
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        assert session is not None and old is not None
        if session.revoked or session.expires_at <= now():
            raise DomainError(401, "invalid_session", "Please sign in again.")
        if not hmac.compare_digest(session.csrf_hash, digest(csrf_value)):
            raise DomainError(403, "csrf_failed", "Reload the page and try again.")
        if old.consumed:
            session.revoked = True
            self.db.add(
                AuditLog(
                    actor_id=session.user_id,
                    action="session.reuse_detected",
                    object_id=str(session.id),
                )
            )
            await self.db.commit()  # Revocation must survive the error response.
            raise DomainError(
                401, "session_reused", "Session reuse detected. Please sign in again."
            )
        old.consumed = True
        credentials = await self.credentials(session, csrf_value)
        self.db.add(RefreshToken(token_hash=digest(credentials.refresh), session_id=session.id))
        await self.db.commit()
        return credentials

    async def consume(self, raw: str, purpose: str, password: str | None = None) -> None:
        action = await self.db.get(ActionToken, digest(raw))
        if action is None or action.purpose != purpose:
            raise DomainError(400, "invalid_link", "This link is invalid or expired.")
        user = await self.db.scalar(select(User).where(User.id == action.user_id).with_for_update())
        action = await self.db.scalar(
            select(ActionToken)
            .where(ActionToken.token_hash == digest(raw))
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if user is None or action is None or action.consumed or action.expires_at <= now():
            raise DomainError(400, "invalid_link", "This link is invalid or expired.")
        if purpose == "verify":
            user.verified = True
        else:
            assert password is not None
            user.password_hash = await asyncio.to_thread(hasher.hash, password)
            await self.db.execute(
                update(Session).where(Session.user_id == user.id).values(revoked=True)
            )
        await self.db.execute(
            update(ActionToken)
            .where(
                ActionToken.user_id == user.id,
                ActionToken.purpose == purpose,
            )
            .values(consumed=True)
        )
        self.db.add(AuditLog(actor_id=user.id, action=f"account.{purpose}", object_id=str(user.id)))
        await self.db.commit()

    async def logout(self, user: User, session_id: object) -> None:
        await self.db.scalar(select(User).where(User.id == user.id).with_for_update())
        await self.db.execute(update(Session).where(Session.id == session_id).values(revoked=True))
        self.db.add(AuditLog(actor_id=user.id, action="session.logout", object_id=str(session_id)))
        await self.db.commit()
