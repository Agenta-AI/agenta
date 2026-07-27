"""Pins the connection-pool-exhaustion invariant for `_get_run_flags` callers.

The bug: fanned-out DAO methods that call `_get_run_flags` once per row instead of
once per distinct run_id either (a) reopen a DB session per row (pool exhaustion)
or (b) at minimum issue redundant queries for a loop-invariant value. These tests
assert the CALL COUNT, not just the result — a correctness-only test would still
pass with the bug present.
"""

from uuid import uuid4
from unittest.mock import AsyncMock

import pytest

from oss.src.core.evaluations.types import (
    EvaluationScenarioEdit,
    EvaluationQueueEdit,
)
from oss.src.dbs.postgres.evaluations import dao as dao_module
from oss.src.dbs.postgres.evaluations.dbes import (
    EvaluationScenarioDBE,
    EvaluationResultDBE,
    EvaluationMetricsDBE,
    EvaluationQueueDBE,
)


class _DummyScalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _DummyResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _DummyScalars(self._rows)


class _DummySession:
    def __init__(self, rows):
        self._rows = rows
        self.deleted = []

    async def execute(self, _stmt):
        return _DummyResult(self._rows)

    async def commit(self):
        return None

    async def delete(self, obj):
        self.deleted.append(obj)


class _DummySessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _patch_engine(monkeypatch, session):
    mock_engine = type(
        "MockEngine", (), {"session": lambda self: _DummySessionContext(session)}
    )()
    monkeypatch.setattr(dao_module, "get_transactions_engine", lambda: mock_engine)
    return mock_engine


def _patch_run_flags(monkeypatch):
    mock = AsyncMock(return_value={})
    monkeypatch.setattr(dao_module, "_get_run_flags", mock)
    return mock


@pytest.mark.asyncio
async def test_edit_scenarios_calls_run_flags_once_per_distinct_run_id(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()  # shared by all 3 rows

    rows = [
        EvaluationScenarioDBE(project_id=project_id, id=uuid4(), run_id=run_id)
        for _ in range(3)
    ]
    session = _DummySession(rows)
    _patch_engine(monkeypatch, session)
    run_flags_mock = _patch_run_flags(monkeypatch)

    dao = dao_module.EvaluationsDAO()
    dao.engine = type(
        "E", (), {"session": lambda self: _DummySessionContext(session)}
    )()

    result = await dao.edit_scenarios(
        project_id=project_id,
        user_id=user_id,
        scenarios=[EvaluationScenarioEdit(id=row.id, meta={"k": "v"}) for row in rows],
    )

    assert len(result) == 3
    # 3 rows, 1 distinct run_id -> exactly one call, not once per row.
    assert run_flags_mock.await_count == 1


@pytest.mark.asyncio
async def test_delete_scenarios_calls_run_flags_once_per_distinct_run_id(monkeypatch):
    project_id = uuid4()
    run_id_a = uuid4()
    run_id_b = uuid4()

    rows = [
        EvaluationScenarioDBE(project_id=project_id, id=uuid4(), run_id=run_id_a),
        EvaluationScenarioDBE(project_id=project_id, id=uuid4(), run_id=run_id_a),
        EvaluationScenarioDBE(project_id=project_id, id=uuid4(), run_id=run_id_b),
    ]
    session = _DummySession(rows)
    run_flags_mock = _patch_run_flags(monkeypatch)

    dao = dao_module.EvaluationsDAO()
    dao.engine = type(
        "E", (), {"session": lambda self: _DummySessionContext(session)}
    )()

    result = await dao.delete_scenarios(
        project_id=project_id,
        scenario_ids=[row.id for row in rows],
    )

    assert len(result) == 3
    # 3 rows, 2 distinct run_ids -> exactly two calls, not three.
    assert run_flags_mock.await_count == 2


@pytest.mark.asyncio
async def test_delete_results_calls_run_flags_once_per_distinct_run_id(monkeypatch):
    project_id = uuid4()
    run_id = uuid4()

    rows = [
        EvaluationResultDBE(
            project_id=project_id,
            id=uuid4(),
            run_id=run_id,
            scenario_id=uuid4(),
        )
        for _ in range(4)
    ]
    session = _DummySession(rows)
    run_flags_mock = _patch_run_flags(monkeypatch)

    dao = dao_module.EvaluationsDAO()
    dao.engine = type(
        "E", (), {"session": lambda self: _DummySessionContext(session)}
    )()

    result = await dao.delete_results(
        project_id=project_id,
        result_ids=[row.id for row in rows],
    )

    assert len(result) == 4
    # 4 rows, 1 distinct run_id -> exactly one call, not four.
    assert run_flags_mock.await_count == 1


@pytest.mark.asyncio
async def test_delete_metrics_calls_run_flags_once_per_distinct_run_id(monkeypatch):
    project_id = uuid4()
    run_id_a = uuid4()
    run_id_b = uuid4()
    run_id_c = uuid4()

    rows = [
        EvaluationMetricsDBE(project_id=project_id, id=uuid4(), run_id=run_id_a),
        EvaluationMetricsDBE(project_id=project_id, id=uuid4(), run_id=run_id_b),
        EvaluationMetricsDBE(project_id=project_id, id=uuid4(), run_id=run_id_c),
    ]
    session = _DummySession(rows)
    run_flags_mock = _patch_run_flags(monkeypatch)

    dao = dao_module.EvaluationsDAO()
    dao.engine = type(
        "E", (), {"session": lambda self: _DummySessionContext(session)}
    )()

    result = await dao.delete_metrics(
        project_id=project_id,
        metrics_ids=[row.id for row in rows],
    )

    assert len(result) == 3
    # 3 rows, 3 distinct run_ids -> one call per distinct id (no dedup possible,
    # but still not more than the number of distinct keys).
    assert run_flags_mock.await_count == 3


@pytest.mark.asyncio
async def test_edit_queues_calls_run_flags_once_per_distinct_run_id(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()

    rows = [
        EvaluationQueueDBE(project_id=project_id, id=uuid4(), run_id=run_id)
        for _ in range(5)
    ]
    session = _DummySession(rows)
    run_flags_mock = _patch_run_flags(monkeypatch)

    dao = dao_module.EvaluationsDAO()
    dao.engine = type(
        "E", (), {"session": lambda self: _DummySessionContext(session)}
    )()

    result = await dao.edit_queues(
        project_id=project_id,
        user_id=user_id,
        queues=[EvaluationQueueEdit(id=row.id) for row in rows],
    )

    assert len(result) == 5
    # 5 rows, 1 distinct run_id -> exactly one call, not five.
    assert run_flags_mock.await_count == 1
