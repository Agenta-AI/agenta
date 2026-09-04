"""Postgres transaction guarantees for durable session input admission and promotion."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
import uuid

from fastapi import HTTPException
import pytest
from sqlalchemy import text

from oss.src.apis.fastapi.sessions.models import PendingInputAdmissionRequest
from oss.src.apis.fastapi.sessions.router import SessionControlRouter
import oss.src.apis.fastapi.sessions.router as router_module
from oss.src.core.sessions.commands.dtos import (
    SessionCommandCreate,
    SessionCommandKind,
    SessionCommandOutcome,
    SessionCommandState,
)
from oss.src.core.sessions.commands.interfaces import DeliveryReceipt
from oss.src.core.sessions.commands.service import SessionCommandsService
from oss.src.core.sessions.executions.dtos import SessionExecutionState
from oss.src.core.sessions.inputs.dtos import PendingInputCreate, PendingInputState
from oss.src.core.sessions.inputs.service import SessionInputsService, input_fingerprint
from oss.src.core.sessions.inputs.types import SessionInputNotRemovable
from oss.src.dbs.postgres.sessions.commands.dao import SessionCommandsDAO
from oss.src.dbs.postgres.sessions.executions.dao import SessionExecutionsDAO
from oss.src.dbs.postgres.sessions.inputs.dao import SessionInputsDAO
import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
import oss.src.models.db_models  # noqa: F401
from oss.src.utils.env import env


pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def input_scope():
    engine = get_transactions_engine()
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()
    session_id = f"input-dao-{project_id.hex[:12]}"

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "input-dao-test",
                "email": f"input-dao-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {
                "id": organization_id,
                "name": "input-dao-test-org",
                "owner_id": user_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {
                "id": workspace_id,
                "name": "input-dao-test-workspace",
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :project_name, :workspace_id, :organization_id)"
            ),
            {
                "id": project_id,
                "project_name": "input-dao-test-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )

    yield {
        "engine": engine,
        "project_id": project_id,
        "user_id": user_id,
        "session_id": session_id,
    }

    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM session_inputs WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.execute(
            text("DELETE FROM session_commands WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.execute(
            text("DELETE FROM session_executions WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.execute(
            text("DELETE FROM projects WHERE id = :id"), {"id": project_id}
        )
        await session.execute(
            text("DELETE FROM workspaces WHERE id = :id"), {"id": workspace_id}
        )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :id"),
            {"id": organization_id},
        )
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})


def _input(scope, *, key: str, message: str, policy: str = "queue"):
    content = {
        "session_id": scope["session_id"],
        "data": {"messages": [message]},
    }
    return PendingInputCreate(
        project_id=scope["project_id"],
        session_id=scope["session_id"],
        content=content,
        policy=policy,
        idempotency_key=key,
        request_fingerprint=input_fingerprint(content=content, policy=policy),
    )


class _BusyStreams:
    async def fetch_header(self, **_kwargs):
        return SimpleNamespace(
            flags=SimpleNamespace(is_running=True), turn_id="source-turn"
        )


class _UnreachableDelivery:
    async def deliver(self, **_kwargs):
        return DeliveryReceipt(status="unreachable")

    async def acknowledge(self, **_kwargs):
        return None


def _settlement_service(scope, inputs):
    streams = SimpleNamespace(
        settle_command=AsyncMock(),
        publish_session_ended=AsyncMock(),
    )
    interactions = SimpleNamespace(
        cancel_session_pending=AsyncMock(return_value=0),
        publish_session_pending_cancelled=AsyncMock(),
    )
    service = SessionCommandsService(
        commands_dao=SessionCommandsDAO(engine=scope["engine"]),
        streams_service=streams,
        interactions_service=interactions,
        lock_engine=None,
        delivery=_UnreachableDelivery(),
        executions_dao=SessionExecutionsDAO(engine=scope["engine"]),
        inputs_dao=inputs,
    )
    service._reconcile_stopped_redis = AsyncMock()
    return service


async def _pending_command(scope, *, data=None):
    return await SessionCommandsDAO(engine=scope["engine"]).create_command(
        user_id=scope["user_id"],
        command=SessionCommandCreate(
            project_id=scope["project_id"],
            session_id=scope["session_id"],
            kind=SessionCommandKind.cancel,
            target_turn_id="source-turn",
            state=SessionCommandState.pending,
            data=data,
        ),
    )


async def test_completion_promotes_one_fifo_input_in_the_settlement_transaction(
    input_scope, monkeypatch
):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    first = await inputs.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="queue-1", message="first"),
    )
    second = await inputs.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="queue-2", message="second"),
    )
    service = _settlement_service(input_scope, inputs)

    assert await service.settle_execution_completed(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        execution_id="source-turn",
    )
    assert await service.settle_execution_completed(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        execution_id="source-turn",
    )

    assert (
        await inputs.fetch_input(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            input_id=first.id,
        )
    ).state == PendingInputState.promoted
    assert [
        item.id
        for item in await inputs.list_pending(
            project_id=input_scope["project_id"], session_id=input_scope["session_id"]
        )
    ] == [second.id]


async def test_manual_stop_commits_without_promoting_pending_input(
    input_scope, monkeypatch
):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    pending = await inputs.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="queue-paused", message="later"),
    )
    command = await _pending_command(input_scope)
    service = _settlement_service(input_scope, inputs)

    settled = await service.settle(
        command_id=command.id,
        project_id=input_scope["project_id"],
        replica_id=None,
        expected_states=[SessionCommandState.pending],
        state=SessionCommandState.applied,
        outcome=SessionCommandOutcome.stopped,
        execution_id="source-turn",
    )

    assert settled is not None
    assert (
        await inputs.fetch_input(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            input_id=pending.id,
        )
    ).state == PendingInputState.pending


async def test_concurrent_idempotent_admission_returns_one_postgres_row(
    input_scope, monkeypatch
):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    service = SessionInputsService(
        inputs_dao=SessionInputsDAO(engine=input_scope["engine"]),
        streams_service=_BusyStreams(),
    )
    kwargs = {
        "project_id": input_scope["project_id"],
        "user_id": input_scope["user_id"],
        "session_id": input_scope["session_id"],
        "content": {"message": "same"},
        "policy": "queue",
        "idempotency_key": "same-key",
    }

    first, retry = await asyncio.wait_for(
        asyncio.gather(service.admit(**kwargs), service.admit(**kwargs)), timeout=5
    )

    assert first.input.id == retry.input.id
    assert (
        len(
            await service.list_pending(
                project_id=input_scope["project_id"],
                session_id=input_scope["session_id"],
            )
        )
        == 1
    )


async def test_conflicting_key_returns_the_409_envelope(input_scope, monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    inputs = SessionInputsService(
        inputs_dao=SessionInputsDAO(engine=input_scope["engine"]),
        streams_service=_BusyStreams(),
    )
    router = SessionControlRouter(
        commands_service=SimpleNamespace(), inputs_service=inputs
    )
    request = SimpleNamespace(
        state=SimpleNamespace(
            project_id=input_scope["project_id"], user_id=input_scope["user_id"]
        ),
        headers={"Idempotency-Key": "conflicting-key"},
    )
    await router.admit_session_input(
        request,
        PendingInputAdmissionRequest(
            session_id=input_scope["session_id"],
            content={"message": "first"},
            on_busy="queue",
        ),
    )

    with pytest.raises(HTTPException) as raised:
        await router.admit_session_input(
            request,
            PendingInputAdmissionRequest(
                session_id=input_scope["session_id"],
                content={"message": "different"},
                on_busy="queue",
            ),
        )

    assert raised.value.status_code == 409
    assert raised.value.detail["code"] == "idempotency_key_reused"
    assert raised.value.detail["retryable"] is False


async def test_promoted_input_cannot_be_removed(input_scope, monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    item = await inputs.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="promoted", message="go"),
    )
    await inputs.promote_next(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        execution_id="next-turn",
    )
    service = SessionInputsService(inputs_dao=inputs, streams_service=_BusyStreams())

    with pytest.raises(SessionInputNotRemovable):
        await service.remove(
            project_id=input_scope["project_id"],
            user_id=input_scope["user_id"],
            session_id=input_scope["session_id"],
            input_id=item.id,
        )


async def test_steer_is_committed_before_failed_stop_and_stays_first(
    input_scope, monkeypatch
):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    dao = SessionInputsDAO(engine=input_scope["engine"])
    await dao.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="older", message="older"),
    )
    inputs = SessionInputsService(inputs_dao=dao, streams_service=_BusyStreams())
    events = []

    class FailedStop:
        async def request_cancel(self, **kwargs):
            pending = await dao.list_pending(
                project_id=input_scope["project_id"],
                session_id=input_scope["session_id"],
            )
            assert pending[0].id == kwargs["steer_input_id"]
            events.append("stop-after-commit")
            raise RuntimeError("runner unavailable")

    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    router = SessionControlRouter(commands_service=FailedStop(), inputs_service=inputs)
    response = await router.admit_session_input(
        SimpleNamespace(
            state=SimpleNamespace(
                project_id=input_scope["project_id"], user_id=input_scope["user_id"]
            ),
            headers={"Idempotency-Key": "steer"},
        ),
        PendingInputAdmissionRequest(
            session_id=input_scope["session_id"],
            content={"message": "steer now"},
            on_busy="steer",
        ),
    )

    pending = await dao.list_pending(
        project_id=input_scope["project_id"], session_id=input_scope["session_id"]
    )
    assert response.status_code == 202
    assert json.loads(response.body)["input"]["id"] == str(pending[0].id)
    assert [item.idempotency_key for item in pending] == ["steer", "older"]
    assert events == ["stop-after-commit"]


async def test_steer_stop_promotes_only_the_bound_input(input_scope, monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    older = await inputs.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="older", message="older"),
    )
    steer = await inputs.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(
            input_scope, key="steer", message="steer now", policy="steer"
        ),
        prioritize=True,
    )
    command = await _pending_command(
        input_scope, data={"steer_input_id": str(steer.id)}
    )
    service = _settlement_service(input_scope, inputs)

    settled = await service.settle(
        command_id=command.id,
        project_id=input_scope["project_id"],
        replica_id=None,
        expected_states=[SessionCommandState.pending],
        state=SessionCommandState.applied,
        outcome=SessionCommandOutcome.stopped,
        execution_id="source-turn",
    )

    assert settled is not None
    assert (
        await inputs.fetch_input(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            input_id=steer.id,
        )
    ).state == PendingInputState.promoted
    assert (
        await inputs.fetch_input(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            input_id=older.id,
        )
    ).state == PendingInputState.pending
    continuation = await SessionExecutionsDAO(
        engine=input_scope["engine"]
    ).fetch_execution(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        execution_id=(
            await inputs.fetch_input(
                project_id=input_scope["project_id"],
                session_id=input_scope["session_id"],
                input_id=steer.id,
            )
        ).promoted_execution_id,
    )
    assert continuation.state == SessionExecutionState.recoverable
