"""Shared fixtures for the service-level test suite.

Each test gets a fresh in-memory SQLite database, freshly created schema, and
the deterministic seed loaded. The clock is pinned to ``SEED_NOW`` so any
"tomorrow"/"in a week" reasoning in the seed lines up with FixedClock.now().
"""

from __future__ import annotations

from typing import AsyncIterator

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, AsyncSession

from core.clock import FixedClock
from core.db.seed import seed_database
from core.db.seed_data import SEED_NOW
from core.db.session import (
    create_schema,
    drop_schema,
    make_engine,
    make_session_factory,
)
from core.integrations.pms.fake import FakePMS


@pytest_asyncio.fixture
async def fixed_clock() -> FixedClock:
    return FixedClock(SEED_NOW)


@pytest_asyncio.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    eng = make_engine("sqlite+aiosqlite:///:memory:")
    await create_schema(eng)
    factory = make_session_factory(eng)
    await seed_database(factory)
    try:
        yield eng
    finally:
        await drop_schema(eng)
        await eng.dispose()


@pytest_asyncio.fixture
async def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return make_session_factory(engine)


@pytest_asyncio.fixture
async def pms(
    session_factory: async_sessionmaker[AsyncSession],
    fixed_clock: FixedClock,
) -> FakePMS:
    return FakePMS(session_factory, clock=fixed_clock)
