"""With a pool of a few connections, a checkout timeout must not read as
"run not found": the evaluation worker would skip the run and ack the message.
"""

from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

from oss.src.dbs.postgres.evaluations import dao as evaluations_dao_module
from oss.src.dbs.postgres.evaluations.dao import EvaluationsDAO


class _TimeoutEngine:
    """An engine whose every checkout times out, like an exhausted pool."""

    def __init__(self) -> None:
        self.checkouts = 0

    @asynccontextmanager
    async def session(self):
        self.checkouts += 1
        raise PoolTimeoutError("QueuePool limit reached, connection timed out")
        yield  # pragma: no cover


@pytest.mark.asyncio
async def test_fetch_run_raises_on_pool_timeout_instead_of_returning_none(
    monkeypatch,
):
    monkeypatch.setattr(evaluations_dao_module, "_FETCH_RUN_BACKOFF_SECONDS", 0)
    engine = _TimeoutEngine()
    dao = EvaluationsDAO(engine=engine)

    with pytest.raises(PoolTimeoutError):
        await dao.fetch_run(project_id=uuid4(), run_id=uuid4())

    assert engine.checkouts == evaluations_dao_module._FETCH_RUN_ATTEMPTS


@pytest.mark.asyncio
async def test_fetch_run_retries_then_succeeds(monkeypatch):
    monkeypatch.setattr(evaluations_dao_module, "_FETCH_RUN_BACKOFF_SECONDS", 0)
    dao = EvaluationsDAO(engine=_TimeoutEngine())
    calls = []

    async def _once(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise PoolTimeoutError("pool exhausted")
        return "run"

    monkeypatch.setattr(dao, "_fetch_run_once", _once)

    assert await dao.fetch_run(project_id=uuid4(), run_id=uuid4()) == "run"
    assert len(calls) == 2
