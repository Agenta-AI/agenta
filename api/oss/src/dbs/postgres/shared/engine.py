from asyncio import current_task
from typing import AsyncGenerator
from contextlib import asynccontextmanager
from math import floor

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    AsyncEngine,
    create_async_engine,
    async_sessionmaker,
    async_scoped_session,
)

from oss.src.dbs.postgres.shared.config import (
    POSTGRES_URI_CORE,
    POSTGRES_URI_TRACING,
)


DATABASE_MEMORY = 16 * 1024 * 1024 * 1024  # 8 GB
DATABASE_FACTOR = 8 * 1024 * 1024 * 1.15  # 8 MB + 15% overhead
DATABASE_MAX_CONNECTIONS = 5000  # 5000 connections
MAX_CONNECTIONS = min(DATABASE_MEMORY / DATABASE_FACTOR, DATABASE_MAX_CONNECTIONS)
APP_CONNECTIONS = MAX_CONNECTIONS * 0.9  # reserve 10% for non-app connections
NOF_CONSUMERS = 2 * 4  # 2 engines x 4 containers
NOF_CONNECTIONS = floor(APP_CONNECTIONS / NOF_CONSUMERS)
POOL_SIZE = floor(NOF_CONNECTIONS * 0.25)
MAX_OVERFLOW = NOF_CONNECTIONS - POOL_SIZE
POOL_RECYCLE = 30 * 60  # 30 minutes


class Engine:
    def __init__(self) -> None:
        self.postgres_uri_core = POSTGRES_URI_CORE

        self.async_core_engine: AsyncEngine = create_async_engine(
            url=self.postgres_uri_core,
            pool_pre_ping=True,
            pool_recycle=POOL_RECYCLE,
            pool_size=POOL_SIZE * CORE_MULTIPLIER,
            max_overflow=MAX_OVERFLOW * CORE_MULTIPLIER,
        )
        self.async_core_session_maker = async_sessionmaker(
            autocommit=False,
            autoflush=False,
            class_=AsyncSession,
            expire_on_commit=False,
            bind=self.async_core_engine,
        )
        self.async_core_session = async_scoped_session(
            session_factory=self.async_core_session_maker,
            scopefunc=current_task,
        )

        self.postgres_uri_tracing = POSTGRES_URI_TRACING

        self.async_tracing_engine: AsyncEngine = create_async_engine(
            url=self.postgres_uri_tracing,
            pool_pre_ping=True,
            pool_recycle=POOL_RECYCLE,
            pool_size=POOL_SIZE * TRACING_MULTIPLIER,
            max_overflow=MAX_OVERFLOW * TRACING_MULTIPLIER,
        )
        self.async_tracing_session_maker = async_sessionmaker(
            autocommit=False,
            autoflush=False,
            class_=AsyncSession,
            expire_on_commit=False,
            bind=self.async_tracing_engine,
        )

        self.async_tracing_session = async_scoped_session(
            session_factory=self.async_tracing_session_maker,
            scopefunc=current_task,
        )

    async def open(self):
        raise NotImplementedError()

    async def close(self):
        if self.async_core_engine is not None:
            await self.async_core_engine.dispose()

        if self.async_tracing_engine is not None:
            await self.async_tracing_engine.dispose()

    @asynccontextmanager
    async def core_session(self) -> AsyncGenerator[AsyncSession, None]:
        session: AsyncSession = self.async_core_session()

        try:
            yield session
            await session.commit()

        except Exception as e:
            await session.rollback()
            raise e

        finally:
            await session.close()

    @asynccontextmanager
    async def tracing_session(self) -> AsyncGenerator[AsyncSession, None]:
        session: AsyncSession = self.async_tracing_session()

        try:
            yield session
            await session.commit()

        except Exception as e:
            await session.rollback()
            raise e

        finally:
            await session.close()

    ### LEGACY CODE ###

    async def init_db(self):
        self.open()

    async def close_db(self):
        self.close()


engine = Engine()
