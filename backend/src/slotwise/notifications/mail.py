import asyncio
import base64
import hashlib
import json
import logging
import smtplib
from datetime import timedelta
from email.message import EmailMessage
from uuid import uuid4

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from slotwise.auth.models import now
from slotwise.core.config import Settings
from slotwise.notifications.models import AuthMail


def cipher(settings: Settings) -> Fernet:
    return Fernet(
        base64.urlsafe_b64encode(
            hashlib.sha256(settings.mail_secret.get_secret_value().encode()).digest(),
        )
    )


def queue_mail(
    db: AsyncSession, settings: Settings, recipient: str, subject: str, body: str
) -> None:
    payload = json.dumps({"to": recipient, "subject": subject, "body": body})
    db.add(AuthMail(id=uuid4(), payload=cipher(settings).encrypt(payload.encode()).decode()))


def send_mail(settings: Settings, mail: AuthMail) -> None:
    payload = json.loads(cipher(settings).decrypt(mail.payload.encode()))
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = payload["to"]
    message["Subject"] = payload["subject"]
    message["Message-ID"] = f"<{mail.id}@slotwise.local>"
    message.set_content(payload["body"])
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password.get_secret_value())
        smtp.send_message(message)


async def deliver_one(factory: async_sessionmaker[AsyncSession], settings: Settings) -> bool:
    async with factory() as db, db.begin():
        mail = await db.scalar(
            select(AuthMail)
            .where(
                AuthMail.delivered_at.is_(None),
                AuthMail.next_attempt <= now(),
                AuthMail.attempts < 8,
            )
            .order_by(AuthMail.next_attempt)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if mail is None:
            return False
        mail.attempts += 1
        try:
            await asyncio.to_thread(send_mail, settings, mail)
        except (smtplib.SMTPException, OSError, InvalidToken) as error:
            mail.last_error = type(error).__name__
            mail.next_attempt = now() + timedelta(seconds=min(3600, 2**mail.attempts * 10))
            logging.getLogger("slotwise").warning("Auth mail delivery deferred")
        else:
            mail.delivered_at = now()
            mail.payload = ""  # Remove recipient and bearer link after delivery.
            mail.last_error = None
        return True


async def mail_loop(factory: async_sessionmaker[AsyncSession], settings: Settings) -> None:
    while True:
        try:
            delivered = await deliver_one(factory, settings)
        except (SQLAlchemyError, OSError):
            logging.getLogger("slotwise").warning("Auth mail database unavailable")
            delivered = False
        await asyncio.sleep(0.2 if delivered else 2)
