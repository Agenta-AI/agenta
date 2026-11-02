import asyncio

import pytest
from oss.src.dbs.postgres.shared.engine import AnalyticsEngine, TransactionsEngine
from sqlalchemy.ext.asyncio import (
    async_scoped_session,
    async_sessionmaker,
    create_async_engine,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("engine_type", [TransactionsEngine, AnalyticsEngine])
async def test_scoped_sessions_are_removed_after_short_tasks(engine_type):
    db = create_async_engine("sqlite+aiosqlite:///:memory:")
    scoped = async_scoped_session(
        async_sessionmaker(db, expire_on_commit=False), scopefunc=asyncio.current_task
    )
    engine = object.__new__(engine_type)
    engine._session = scoped
    try:

        async def use_session():
            async with engine.session():
                pass

        await asyncio.gather(*(use_session() for _ in range(50)))
        assert not scoped.registry.registry
    finally:
        await db.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("engine_type", [TransactionsEngine, AnalyticsEngine])
async def test_scoped_session_removed_after_rollback(engine_type):
    db = create_async_engine("sqlite+aiosqlite:///:memory:")
    scoped = async_scoped_session(
        async_sessionmaker(db, expire_on_commit=False), scopefunc=asyncio.current_task
    )
    engine = object.__new__(engine_type)
    engine._session = scoped
    try:
        with pytest.raises(ValueError):
            async with engine.session():
                raise ValueError("rollback")
        assert not scoped.registry.registry
    finally:
        await db.dispose()
