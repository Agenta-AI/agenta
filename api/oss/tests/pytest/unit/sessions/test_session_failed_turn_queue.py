from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from oss.src.core.sessions.commands.service import SessionCommandsService


@pytest.mark.asyncio
async def test_failed_execution_promotes_and_delivers_one_queued_input():
    transaction = object()

    @asynccontextmanager
    async def open_transaction():
        yield transaction

    commands_dao = SimpleNamespace(transaction=open_transaction)
    executions_dao = SimpleNamespace(
        settle=AsyncMock(
            return_value=SimpleNamespace(
                won=True,
                settlement=SimpleNamespace(terminal_outcome="failed"),
            )
        )
    )
    service = SessionCommandsService(
        commands_dao=commands_dao,
        streams_service=SimpleNamespace(),
        interactions_service=SimpleNamespace(),
        lock_engine=None,
        delivery=SimpleNamespace(),
        executions_dao=executions_dao,
    )
    promoted = SimpleNamespace(command=object())
    service._promote_next_input = AsyncMock(return_value=promoted)
    service._reconcile_stopped_redis = AsyncMock()
    service._deliver = AsyncMock(return_value=SimpleNamespace(status="accepted"))

    project_id = uuid4()
    result = await service.settle_execution_failed(
        project_id=project_id,
        session_id="synthetic-session",
        execution_id="failed-turn",
    )

    assert result is True
    executions_dao.settle.assert_awaited_once_with(
        project_id=project_id,
        session_id="synthetic-session",
        execution_id="failed-turn",
        terminal_outcome="failed",
        settled_by="runner",
        transaction=transaction,
    )
    service._promote_next_input.assert_awaited_once_with(
        project_id=project_id,
        session_id="synthetic-session",
        parent_execution_id="failed-turn",
        transaction=transaction,
    )
    service._reconcile_stopped_redis.assert_awaited_once_with(
        project_id=project_id,
        session_id="synthetic-session",
        execution_id="failed-turn",
    )
    service._deliver.assert_awaited_once_with(promoted.command)
