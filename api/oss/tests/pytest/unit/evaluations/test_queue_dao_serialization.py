from uuid import uuid4
from unittest.mock import AsyncMock
import warnings

import pytest

from oss.src.core.evaluations.types import (
    EvaluationQueue,
    EvaluationQueueCreate,
    EvaluationQueueData,
    EvaluationStatus,
)
from oss.src.dbs.postgres.evaluations import dao as dao_module


class _DummySession:
    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        return None


class _DummySessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_create_queue_serializes_queue_data_without_uuid_warnings(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    assignee_a = uuid4()
    assignee_b = uuid4()

    session = _DummySession()
    captured = {}

    monkeypatch.setattr(
        dao_module,
        "_get_run_flags",
        AsyncMock(return_value={}),
    )
    # Mock get_transactions_engine to return an engine with session method
    mock_engine = type('MockEngine', (), {'session': lambda self: _DummySessionContext(session)})()
    monkeypatch.setattr(
        dao_module,
        "get_transactions_engine",
        lambda: mock_engine,
    )

    def fake_create_dto_from_dbe(*, DTO, dbe):
        captured["data"] = dbe.data
        return EvaluationQueue(
            id=uuid4(),
            run_id=run_id,
            status=EvaluationStatus.RUNNING,
            data=EvaluationQueueData(
                user_ids=[[assignee_a, assignee_b]],
                step_keys=["annotation-step"],
            ),
        )

    monkeypatch.setattr(dao_module, "create_dto_from_dbe", fake_create_dto_from_dbe)

    queue = EvaluationQueueCreate(
        status=EvaluationStatus.RUNNING,
        data=EvaluationQueueData(
            user_ids=[[assignee_a, assignee_b]],
            step_keys=["annotation-step"],
        ),
        run_id=run_id,
    )

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        created = await dao_module.EvaluationsDAO().create_queue(
            project_id=project_id,
            user_id=user_id,
            queue=queue,
        )

    assert created is not None
    assert captured["data"]["user_ids"] == [[str(assignee_a), str(assignee_b)]]
    assert all("field_name='user_ids'" not in str(w.message) for w in caught)
