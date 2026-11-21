import asyncio

from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context
from slotwise.core.config import get_settings
from slotwise.db import models  # noqa: F401
from slotwise.db.base import Base


def run_migrations(connection):
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()


async def online():
    engine = create_async_engine(get_settings().database_url.get_secret_value())
    async with engine.connect() as connection:
        await connection.run_sync(run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    context.configure(
        url=get_settings().database_url.get_secret_value(),
        literal_binds=True,
        target_metadata=Base.metadata,
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(online())
