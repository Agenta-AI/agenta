from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def build_engine(
    database_path: Path,
) -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    resolved_path = Path(database_path).resolve()
    engine = create_async_engine(f"sqlite+aiosqlite:///{resolved_path}")

    @event.listens_for(engine.sync_engine, "connect")
    def _apply_pragmas(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
        finally:
            cursor.close()

    return engine, async_sessionmaker(engine, expire_on_commit=False)


@asynccontextmanager
async def immediate_transaction(
    bind: AsyncEngine | async_sessionmaker,
) -> AsyncIterator[AsyncConnection]:
    engine = bind if isinstance(bind, AsyncEngine) else bind.kw["bind"]
    conn = await engine.connect()
    try:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        await conn.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            yield conn
        except BaseException:
            with suppress(Exception):
                await conn.exec_driver_sql("ROLLBACK")
            raise
        else:
            await conn.exec_driver_sql("COMMIT")
    finally:
        await conn.close()


async def connection_pragmas(conn: AsyncConnection) -> dict[str, object]:
    return {
        "foreign_keys": (await conn.execute(text("PRAGMA foreign_keys"))).scalar(),
        "journal_mode": (await conn.execute(text("PRAGMA journal_mode"))).scalar(),
        "busy_timeout": (await conn.execute(text("PRAGMA busy_timeout"))).scalar(),
    }
