from asyncio import current_task
from typing import AsyncGenerator, Type, Optional, Any
from contextlib import asynccontextmanager
from math import floor
from collections.abc import Mapping


from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.orm import Session
from sqlalchemy.sql import Executable, Select
from sqlalchemy.engine import Result


from sqlalchemy.ext.asyncio import (
    AsyncSession,
    AsyncEngine,
    create_async_engine,
    async_sessionmaker,
    async_scoped_session,
)

from oss.src.utils.logging import get_module_logger

from oss.src.dbs.postgres.shared.config import (
    POSTGRES_URI_CORE,
    POSTGRES_URI_TRACING,
)

log = get_module_logger(__name__)

# import logging

# logging.basicConfig()
# logging.getLogger("sqlalchemy.engine").setLevel(logging.INFO)


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


class _FakeScalars:
    def __init__(self, result, map):
        self.result = result
        self.map = map

    def first(self):
        return self.map(self.result.first())

    def all(self):
        return [self.map(r) for r in self.result.all()]

    def one(self):
        return self.map(self.result.one())

    def one_or_none(self):
        return self.map(self.result.one_or_none())

    def scalar(self):
        return self.result.scalar()


class ResultProxy:
    def __init__(
        self,
        result: Result,
        model: Optional[Type] = None,
        is_session: bool = False,
    ):
        self._result = result
        self._model = model
        self._is_session = is_session

    def scalars(self):
        if self._is_session:
            return self._result.scalars()
        else:
            return _FakeScalars(self._result, self._map.__get__(self))

    def first(self):
        row = self._result.first()
        return self._map(row)

    def all(self):
        return [self._map(r) for r in self._result.all()]

    def one(self):
        return self._map(self._result.one())

    def one_or_none(self):
        return self._map(self._result.one_or_none())

    def scalar(self):
        return self._result.scalar()

    def scalar_one(self):
        return self._result.scalar_one()

    def scalar_one_or_none(self):
        return self._result.scalar_one_or_none()

    def unique(self, *criterion):
        return self._wrap(self._result.unique(*criterion))

    def mappings(self, *args, **kwargs):
        return self._result.mappings(*args, **kwargs)

    def _map(self, row: Any) -> Any:
        if row is None or self._model is None or isinstance(row, self._model):
            return row  # already good

        # Row or RowMapping ─ both expose the underlying dict via _mapping
        if hasattr(row, "_mapping"):  # Row, not RowMapping
            return self._model(**row._mapping)

        if isinstance(row, Mapping):  # RowMapping
            return self._model(**row)

        if hasattr(row, "_asdict"):  # named-tuple style
            return self._model(**row._asdict())

        if isinstance(row, dict):  # plain dict
            return self._model(**row)

        # scalar fall-back
        return self._model(row)

    def __getattr__(self, attr: str) -> Any:
        return getattr(self._result, attr)

    def _wrap(self, result: Result) -> "ResultProxy":
        return ResultProxy(
            result=result,
            model=self._model,
            is_session=self._is_session,
        )


class AsyncOrmConnectionProxy:
    def __init__(self, connection: AsyncConnection):
        self._conn = connection

    async def execute(
        self,
        stmt: Executable,
        *,
        prepare: bool = False,
        model: Optional[Type] = None,
        **kwargs,
    ) -> ResultProxy:
        stmt = stmt.execution_options(
            prepare=prepare,
        )

        use_session = self._requires_session(stmt)
        inferred_model = model or self._infer_model(stmt)

        if use_session:

            def run(sync_conn):
                session = Session(
                    bind=sync_conn,
                    autoflush=False,
                    expire_on_commit=False,
                    autobegin=True,
                )
                result = session.execute(stmt, **kwargs)
                return ResultProxy(result=result, model=inferred_model, is_session=True)

            return await self._conn.run_sync(run)
        else:
            result = await self._conn.execute(stmt, **kwargs)
            return ResultProxy(result=result, model=inferred_model, is_session=False)

    def _requires_session(self, stmt: Executable) -> bool:
        return bool(getattr(stmt, "_with_options", []))

    def _infer_model(self, stmt: Executable) -> Optional[Type]:
        if not isinstance(stmt, Select):
            return None

        for desc in stmt.column_descriptions:
            entity = desc.get("entity")
            if isinstance(entity, type):
                return entity
        return None

    def __getattr__(self, attr: str) -> Any:
        return getattr(self._conn, attr)


class Engine:
    def __init__(self) -> None:
        self.postgres_uri_core = POSTGRES_URI_CORE

        self.async_core_engine: AsyncEngine = create_async_engine(
            url=self.postgres_uri_core,
            pool_pre_ping=True,
            pool_recycle=POOL_RECYCLE,
            pool_size=POOL_SIZE,
            max_overflow=MAX_OVERFLOW,
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
            pool_size=POOL_SIZE,
            max_overflow=MAX_OVERFLOW,
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
    async def core_connection(self) -> AsyncGenerator[AsyncOrmConnectionProxy, None]:
        async with self.async_core_engine.connect() as connection:
            yield AsyncOrmConnectionProxy(connection)

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

    @asynccontextmanager
    async def tracing_connection(self) -> AsyncGenerator[AsyncOrmConnectionProxy, None]:
        async with self.async_tracing_engine.connect() as connection:
            yield AsyncOrmConnectionProxy(connection)

    ### LEGACY CODE ###

    async def init_db(self):
        self.open()

    async def close_db(self):
        self.close()


engine = Engine()
