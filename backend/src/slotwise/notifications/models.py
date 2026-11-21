from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from slotwise.auth.models import now
from slotwise.db.base import Base


class AuthMail(Base):
    __tablename__ = "auth_mail"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    payload: Mapped[str] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(default=0)
    next_attempt: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(50))
