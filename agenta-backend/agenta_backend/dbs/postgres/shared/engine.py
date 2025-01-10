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

from agenta_backend.dbs.postgres.shared.config import POSTGRES_URI


class Engine:
    def __init__(self) -> None:
        self.postgres_uri = POSTGRES_URI

        self.async_engine: AsyncEngine = create_async_engine(
            url=self.postgres_uri,
        )
        self.async_session_maker = async_sessionmaker(
            autocommit=False,
            autoflush=False,
            class_=AsyncSession,
            expire_on_commit=False,
            bind=self.async_engine,
        )
        self.async_session = async_scoped_session(
            session_factory=self.async_session_maker,
            scopefunc=current_task,
        )

    async def open(self):
        raise NotImplementedError()

    async def close(self):
        if self.async_engine is None:
            raise Exception("Engine is not open, cannot close it.")

        await self.async_engine.dispose()

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession, None]:
        session: AsyncSession = self.async_session()

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
