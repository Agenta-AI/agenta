from asyncio import current_task
from typing import AsyncGenerator, Optional
from contextlib import asynccontextmanager
from math import floor

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    AsyncEngine,
    create_async_engine,
    async_sessionmaker,
    async_scoped_session,
)

from oss.src.utils.env import env


DATABASE_MEMORY = 32 * 1024 * 1024 * 1024  # 32 GB
DATABASE_FACTOR = 8 * 1024 * 1024 * 1.15  # 8 MB + 15% overhead
DATABASE_MAX_CONNECTIONS = 5000
MAX_CONNECTIONS = min(DATABASE_MEMORY / DATABASE_FACTOR, DATABASE_MAX_CONNECTIONS)
APP_CONNECTIONS = MAX_CONNECTIONS * 0.9
NOF_CONSUMERS = 2 * 4  # 2 engines x 4 containers
NOF_CONNECTIONS = floor(APP_CONNECTIONS / NOF_CONSUMERS)
POOL_SIZE = floor(NOF_CONNECTIONS * 0.25)
MAX_OVERFLOW = NOF_CONNECTIONS - POOL_SIZE
POOL_RECYCLE = 30 * 60  # 30 minutes


class TransactionsEngine:
    """Postgres core DB — application data."""

    def __init__(self) -> None:
        self._engine: AsyncEngine = create_async_engine(
            url=env.postgres.uri_core,
            pool_pre_ping=True,
            pool_recycle=POOL_RECYCLE,
            pool_size=POOL_SIZE,
            max_overflow=MAX_OVERFLOW,
        )
        _session_maker = async_sessionmaker(
            autocommit=False,
            autoflush=False,
            class_=AsyncSession,
            expire_on_commit=False,
            bind=self._engine,
        )
        self._session = async_scoped_session(
            session_factory=_session_maker,
            scopefunc=current_task,
        )

    async def close(self) -> None:
        if self._engine is not None:
            await self._engine.dispose()

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession, None]:
        session: AsyncSession = self._session()
        try:
            yield session
            await session.commit()
        except Exception as e:
            await session.rollback()
            raise e
        finally:
            await session.close()


class AnalyticsEngine:
    """Postgres tracing DB — observability data."""

    def __init__(self) -> None:
        self._engine: AsyncEngine = create_async_engine(
            url=env.postgres.uri_tracing,
            pool_pre_ping=True,
            pool_recycle=POOL_RECYCLE,
            pool_size=POOL_SIZE,
            max_overflow=MAX_OVERFLOW,
        )
        _session_maker = async_sessionmaker(
            autocommit=False,
            autoflush=False,
            class_=AsyncSession,
            expire_on_commit=False,
            bind=self._engine,
        )
        self._session = async_scoped_session(
            session_factory=_session_maker,
            scopefunc=current_task,
        )

    async def close(self) -> None:
        if self._engine is not None:
            await self._engine.dispose()

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession, None]:
        session: AsyncSession = self._session()
        try:
            yield session
            await session.commit()
        except Exception as e:
            await session.rollback()
            raise e
        finally:
            await session.close()


_transactions_engine: Optional[TransactionsEngine] = None
_analytics_engine: Optional[AnalyticsEngine] = None


def get_transactions_engine() -> TransactionsEngine:
    global _transactions_engine
    if _transactions_engine is None:
        _transactions_engine = TransactionsEngine()
    return _transactions_engine


def get_analytics_engine() -> AnalyticsEngine:
    global _analytics_engine
    if _analytics_engine is None:
        _analytics_engine = AnalyticsEngine()
    return _analytics_engine
