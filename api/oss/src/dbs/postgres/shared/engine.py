from asyncio import current_task
from dataclasses import dataclass
from typing import AsyncGenerator, Optional
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    AsyncEngine,
    create_async_engine,
    async_sessionmaker,
    async_scoped_session,
)

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


# Every process builds both engines, so one process reserves this many pools.
ENGINES_PER_PROCESS = 2

PROFILE_API = "api"
PROFILE_WORKER = "worker"


@dataclass(frozen=True)
class PoolSizing:
    """The four pool settings SQLAlchemy needs, for one engine in one process."""

    pool_size: int
    max_overflow: int
    pool_recycle: int
    pool_timeout: int

    @property
    def peak_connections(self) -> int:
        return self.pool_size + self.max_overflow


def resolve_pool_sizing(
    *,
    profile: str,
    #
    pool_size: int,
    max_overflow: int,
    #
    worker_pool_size: int,
    worker_max_overflow: int,
    #
    pool_recycle: int,
    pool_timeout: int,
) -> PoolSizing:
    """Pick the pool settings for one engine in a process of the given profile.

    The worker profile gets its own, narrower pool. A queue or stream consumer
    opens many connections during a burst and then idles, and an idle connection
    that sits inside `pool_size` is never closed. A narrow pool keeps the steady
    state small and pushes the burst through overflow, which does close on
    check-in.
    """

    if profile == PROFILE_WORKER:
        pool_size, max_overflow = worker_pool_size, worker_max_overflow

    return PoolSizing(
        # SQLAlchemy accepts pool_size=0, which means an unbounded pool. That is
        # the failure this sizing exists to prevent, so the floor is 1.
        pool_size=max(1, pool_size),
        max_overflow=max(0, max_overflow),
        pool_recycle=pool_recycle,
        pool_timeout=pool_timeout,
    )


def pool_budget_warning(
    *,
    sizing: PoolSizing,
    max_connections: int,
    consumers: int,
    engines_per_process: int = ENGINES_PER_PROCESS,
) -> Optional[str]:
    """Return a warning when the configured pool cannot fit the server's limit.

    Returns None when it fits. Advisory only: the numbers describe what every
    process would hold at the same time, which no single process can check.
    """

    demand = sizing.peak_connections * engines_per_process * consumers

    if demand <= max_connections:
        return None

    return (
        f"Postgres pool is oversized: {consumers} processes x "
        f"{engines_per_process} engines x {sizing.peak_connections} connections "
        f"= {demand}, above max_connections={max_connections}. "
        "Lower POSTGRES_POOL_SIZE/POSTGRES_MAX_OVERFLOW or raise the server limit."
    )


_profile: str = PROFILE_API

_transactions_engine: Optional["TransactionsEngine"] = None
_analytics_engine: Optional["AnalyticsEngine"] = None


def set_pool_profile(profile: str) -> None:
    """Declare this process's pool profile. Call it before the first engine.

    Raises if an engine already exists, because that engine would keep the
    profile's sizing and the call would have had no effect.
    """

    global _profile

    if _transactions_engine is not None or _analytics_engine is not None:
        raise RuntimeError(
            f"set_pool_profile({profile!r}) ran after an engine was built; "
            "move the call ahead of the first get_*_engine()"
        )

    _profile = profile


def current_pool_sizing() -> PoolSizing:
    return resolve_pool_sizing(
        profile=_profile,
        #
        pool_size=env.postgres.pool_size,
        max_overflow=env.postgres.max_overflow,
        #
        worker_pool_size=env.postgres.worker_pool_size,
        worker_max_overflow=env.postgres.worker_max_overflow,
        #
        pool_recycle=env.postgres.pool_recycle_seconds,
        pool_timeout=env.postgres.pool_timeout_seconds,
    )


def _log_pool_sizing(name: str, sizing: PoolSizing) -> None:
    log.info(
        "[postgres] pool",
        engine=name,
        profile=_profile,
        pool_size=sizing.pool_size,
        max_overflow=sizing.max_overflow,
        pool_recycle=sizing.pool_recycle,
        pool_timeout=sizing.pool_timeout,
    )

    warning = pool_budget_warning(
        sizing=sizing,
        max_connections=env.postgres.max_connections,
        consumers=env.postgres.pool_consumers,
    )

    if warning:
        log.warn(warning)


class TransactionsEngine:
    """Postgres core DB — application data."""

    def __init__(self) -> None:
        sizing = current_pool_sizing()
        _log_pool_sizing("transactions", sizing)

        self._engine: AsyncEngine = create_async_engine(
            url=env.postgres.uri_core,
            pool_pre_ping=True,
            pool_recycle=sizing.pool_recycle,
            pool_size=sizing.pool_size,
            max_overflow=sizing.max_overflow,
            pool_timeout=sizing.pool_timeout,
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

    @asynccontextmanager
    async def transaction(self) -> AsyncGenerator[AsyncConnection, None]:
        """A transaction on its own pooled connection, outside the task-scoped session.
        `session()` hands every nested caller in one task the same session and commits
        it on the first exit, so anything that must outlive nested sessions (a
        transaction-scoped lock, say) needs this instead."""
        async with self._engine.connect() as connection:
            async with connection.begin():
                yield connection


class AnalyticsEngine:
    """Postgres tracing DB — observability data."""

    def __init__(self) -> None:
        sizing = current_pool_sizing()
        _log_pool_sizing("analytics", sizing)

        self._engine: AsyncEngine = create_async_engine(
            url=env.postgres.uri_tracing,
            pool_pre_ping=True,
            pool_recycle=sizing.pool_recycle,
            pool_size=sizing.pool_size,
            max_overflow=sizing.max_overflow,
            pool_timeout=sizing.pool_timeout,
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
