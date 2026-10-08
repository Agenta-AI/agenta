"""Unit test: an analytics statement timeout reaches the caller as an error.

No live DB: a fake session raises the DBAPIError that asyncpg produces when
`statement_timeout` fires, so the DAO's mapping can be asserted without Postgres.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy.exc import DBAPIError

from oss.src.core.shared.dtos import Windowing
from oss.src.core.tracing.dtos import AnalyticsQueryTimeoutError, TracingQuery
from oss.src.core.tracing.service import TracingService
from oss.src.dbs.postgres.tracing.dao import TracingDAO


class _AsyncpgError(Exception):
    def __init__(self, message: str, sqlstate: str):
        super().__init__(message)
        self.sqlstate = sqlstate


class _FailingSession:
    def __init__(self, error: Exception):
        self._error = error
        self._calls = 0

    async def execute(self, stmt):
        self._calls += 1
        if self._calls > 1:  # the first call sets statement_timeout
            raise self._error


class _FailingEngine:
    def __init__(self, error: Exception):
        self._error = error

    @asynccontextmanager
    async def session(self):
        yield _FailingSession(self._error)


def _query() -> TracingQuery:
    newest = datetime.now(timezone.utc)
    return TracingQuery(
        windowing=Windowing(
            oldest=newest - timedelta(days=30),
            newest=newest,
            interval=720,
        )
    )


def _dbapi_error(message: str, sqlstate: str) -> DBAPIError:
    return DBAPIError(
        statement="SELECT 1",
        params=None,
        orig=_AsyncpgError(message, sqlstate),
    )


@pytest.mark.anyio
async def test_analytics_statement_timeout_raises(anyio_backend):
    assert anyio_backend == "asyncio"
    error = _dbapi_error(
        "<class 'asyncpg.exceptions.QueryCanceledError'>: "
        "canceling statement due to statement timeout",
        "57014",
    )
    dao = TracingDAO(engine=_FailingEngine(error))

    with pytest.raises(AnalyticsQueryTimeoutError):
        await dao.analytics(
            project_id=uuid4(),
            query=_query(),
            specs=TracingService.default_analytics_specs(),
        )


@pytest.mark.anyio
async def test_analytics_other_db_errors_stay_suppressed(anyio_backend):
    assert anyio_backend == "asyncio"
    error = _dbapi_error("connection reset", "08006")
    dao = TracingDAO(engine=_FailingEngine(error))

    buckets = await dao.analytics(
        project_id=uuid4(),
        query=_query(),
        specs=TracingService.default_analytics_specs(),
    )

    assert buckets == []
