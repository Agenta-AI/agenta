"""Async SQLAlchemy session factory.

Tiny module on purpose. The fake calls ``make_session_factory(db_url)`` once
at construction; tests build a session factory pointing at a fresh sqlite
file (or ``:memory:``) per test.
"""

from __future__ import annotations

from typing import Callable

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from core.db.tables import Base

SessionFactory = Callable[[], AsyncSession]


def make_engine(db_url: str = "sqlite+aiosqlite:///:memory:") -> AsyncEngine:
    """Build an async engine. ``echo`` is intentionally off; flip in tests if needed."""

    return create_async_engine(db_url, future=True)


def make_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def create_schema(engine: AsyncEngine) -> None:
    """Create all tables. Idempotent — safe to call repeatedly."""

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def drop_schema(engine: AsyncEngine) -> None:
    """Drop all tables. Mostly useful for tests."""

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
