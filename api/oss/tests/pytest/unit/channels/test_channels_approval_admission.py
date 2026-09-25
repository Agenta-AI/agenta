"""Channels uses the same durable approval admission as the sessions API."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from entrypoints import worker_queues


@pytest.mark.asyncio
async def test_worker_answers_through_durable_admission(monkeypatch):
    commands = SimpleNamespace(respond_interaction=AsyncMock())
    captured = {}
    for name in (
        "get_transactions_engine",
        "get_analytics_engine",
        "get_lock_engine",
        "GitDAO",
        "WorkflowsService",
        "EnvironmentsService",
        "EmbedsService",
        "_build_channels_service",
    ):
        monkeypatch.setattr(worker_queues, name, MagicMock())
    monkeypatch.setattr(
        worker_queues, "SessionCommandsService", lambda **kwargs: commands
    )
    monkeypatch.setattr(
        worker_queues,
        "ChannelsInboxWorker",
        lambda **kwargs: captured.update(kwargs),
    )
    worker_queues._build_channels_inbox_broker()
    respond = captured["dispatcher"]._respond_interaction_fn
    project_id, user_id, interaction_id = uuid4(), uuid4(), uuid4()
    answer = {"approved": True, "message": "Approve"}
    await respond(
        project_id=project_id,
        user_id=user_id,
        interaction_id=interaction_id,
        answer=answer,
    )
    commands.respond_interaction.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        interaction_id=interaction_id,
        answer=answer,
        expected_execution_id=None,
        idempotency_key=f"channels:{interaction_id}",
    )
