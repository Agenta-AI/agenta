from asyncio import current_task
from typing import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    AsyncEngine,
    create_async_engine,
    async_sessionmaker,
    async_scoped_session,
)

from oss.src.models.db.config import (
    POSTGRES_URI_CORE,
    POSTGRES_URI_TRACING,
)


class DBEngine:
    """
    Database engine to initialize SQLAlchemy (and Beanie ODM)
    """

    def __init__(self) -> None:
        self.postgres_uri_core = POSTGRES_URI_CORE

        self.core_engine: AsyncEngine = create_async_engine(
            url=self.postgres_uri_core,
            pool_pre_ping=True,
            pool_recycle=1800,
            pool_size=25,
            max_overflow=50,
        )  # type: ignore
        self.async_core_session_maker = async_sessionmaker(
            bind=self.core_engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        self.async_core_session = async_scoped_session(
            session_factory=self.async_core_session_maker,
            scopefunc=current_task,
        )

        self.postgres_uri_tracing = POSTGRES_URI_TRACING

        self.tracing_engine: AsyncEngine = create_async_engine(
            url=self.postgres_uri_tracing,
            pool_pre_ping=True,
            pool_recycle=1800,
            pool_size=25,
            max_overflow=50,
        )  # type: ignore
        self.async_tracing_session_maker = async_sessionmaker(
            bind=self.tracing_engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        self.async_tracing_session = async_scoped_session(
            session_factory=self.async_tracing_session_maker,
            scopefunc=current_task,
        )

    async def init_db(self):
        """
        Initialize the database for either cloud/ee or oss.
        """

        raise NotImplementedError()

    @asynccontextmanager
    async def get_core_session(self) -> AsyncGenerator[AsyncSession, None]:
        """
        Async context manager to yield a database session.

        This context manager ensures that any changes made during the session are
        rolled back in case of an exception, and the session is properly closed to
        prevent memory leaks.

        Yields:
            AsyncSession: SQLAlchemy async session for database operations.

        Raises:
            Exception: Any exception that occurs within the context will be
            re-raised after the session rollback.
        """

        session = self.async_core_session()
        try:
            yield session
        except Exception as e:
            await session.rollback()
            raise e
        finally:
            await session.close()

    @asynccontextmanager
    async def get_tracing_session(self) -> AsyncGenerator[AsyncSession, None]:
        session = self.async_tracing_session()
        try:
            yield session
        except Exception as e:
            await session.rollback()
            raise e
        finally:
            await session.close()

    async def close_db(self):
        """
        Closes and dispose all the connections using the engine.

        :raises     Exception:  if engine is initialized
        """

        if self.engine is None:
            raise Exception("DBEngine is not initialized")

        await self.engine.dispose()


# Initialize db engine
db_engine = DBEngine()
