from asyncio import current_task
from typing import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    create_async_engine,
    async_sessionmaker,
    async_scoped_session,
)

from agenta_backend.models.db.config import POSTGRES_URI


class DBEngine:
    """
    Database engine to initialize SQLAlchemy (and Beanie ODM)
    """

    def __init__(self) -> None:
        self.postgres_uri = POSTGRES_URI
        self.engine = create_async_engine(url=self.postgres_uri)  # type: ignore
        self.async_session_maker = async_sessionmaker(
            bind=self.engine, class_=AsyncSession, expire_on_commit=False
        )
        self.async_session = async_scoped_session(
            session_factory=self.async_session_maker, scopefunc=current_task
        )

    async def init_db(self):
        """
        Initialize the database for either cloud/ee or oss.
        """

        raise NotImplementedError()

    @asynccontextmanager
    async def get_session(self) -> AsyncGenerator[AsyncSession, None]:
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

        session = self.async_session()
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
