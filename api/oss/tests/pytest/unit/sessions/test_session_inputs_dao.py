"""Postgres transaction guarantees for durable session input admission and promotion."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock
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
from oss.src.core.sessions.commands import service as commands_service_module
from oss.src.core.sessions.commands.service import SessionCommandsService
from oss.src.core.sessions.commands.types import ExecutionExpectationFailed
from oss.src.core.sessions.executions.dtos import SessionExecutionState
from oss.src.core.sessions.inputs.dtos import (
    PendingInputCreate,
    PendingInputState,
    PendingInputUpdate,
    PendingInputAttachment,
)
from oss.src.core.sessions.inputs.service import (
    SessionInputsService,
    input_fingerprint,
    edit_pending_input_content,
)
from oss.src.core.sessions.inputs.types import (
    SessionInputBusy,
    SessionInputNotEditable,
    SessionInputContentInvalid,
    SessionInputNotFound,
    SessionInputNotRemovable,
    SessionInputRemoved,
)
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
            flags=SimpleNamespace(is_running=True),
            turn_id="source-turn",
            turn_started_at=None,
        )


class _SettlementRaceStreams(_BusyStreams):
    def __init__(self):
        self.observed_busy = asyncio.Event()
        self.allow_admission = asyncio.Event()

    async def fetch_header(self, **_kwargs):
        self.observed_busy.set()
        await self.allow_admission.wait()
        return await super().fetch_header()


class _UnreachableDelivery:
    async def deliver(self, **_kwargs):
        return DeliveryReceipt(status="unreachable")

    async def acknowledge(self, **_kwargs):
        return None


def _settlement_service(scope, inputs, *, commands=None, executions=None):
    streams = SimpleNamespace(
        settle_command=AsyncMock(),
        publish_session_ended=AsyncMock(),
    )
    interactions = SimpleNamespace(
        cancel_session_pending=AsyncMock(return_value=0),
        publish_session_pending_cancelled=AsyncMock(),
    )
    service = SessionCommandsService(
        commands_dao=commands or SessionCommandsDAO(engine=scope["engine"]),
        streams_service=streams,
        interactions_service=interactions,
        lock_engine=None,
        delivery=_UnreachableDelivery(),
        executions_dao=executions or SessionExecutionsDAO(engine=scope["engine"]),
        inputs_dao=inputs,
    )
    service._reconcile_stopped_redis = AsyncMock()
    return service


def _cancel_service(scope, inputs, *, executions):
    return SessionCommandsService(
        commands_dao=SessionCommandsDAO(engine=scope["engine"]),
        streams_service=_BusyStreams(),
        interactions_service=SimpleNamespace(
            cancel_session_pending=AsyncMock(return_value=0),
            publish_session_pending_cancelled=AsyncMock(),
        ),
        lock_engine=None,
        delivery=_UnreachableDelivery(),
        executions_dao=executions,
        inputs_dao=inputs,
    )


class _PausingExecutionsDAO(SessionExecutionsDAO):
    def __init__(self, *, engine):
        super().__init__(engine=engine)
        self.locked = asyncio.Event()
        self.release = asyncio.Event()

    async def lock_for_control(self, **kwargs):
        execution = await super().lock_for_control(**kwargs)
        if not self.locked.is_set():
            self.locked.set()
            await self.release.wait()
        return execution


class _ObservedExecutionsDAO(SessionExecutionsDAO):
    def __init__(self, *, engine):
        super().__init__(engine=engine)
        self.lock_attempted = asyncio.Event()

    async def lock_for_control(self, **kwargs):
        self.lock_attempted.set()
        return await super().lock_for_control(**kwargs)


class _ObservedCommandsDAO(SessionCommandsDAO):
    def __init__(self, *, engine):
        super().__init__(engine=engine)
        self.command_observed = asyncio.Event()

    async def fetch_command(self, **kwargs):
        command = await super().fetch_command(**kwargs)
        if kwargs.get("transaction") is None:
            self.command_observed.set()
        return command


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
    ] == [first.id, second.id]

    await SessionExecutionsDAO(engine=input_scope["engine"]).set_state(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        execution_id=(
            await inputs.fetch_input(
                project_id=input_scope["project_id"],
                session_id=input_scope["session_id"],
                input_id=first.id,
            )
        ).promoted_execution_id,
        state=SessionExecutionState.running,
        expected_states=[SessionExecutionState.recoverable],
    )
    assert [
        item.id
        for item in await inputs.list_pending(
            project_id=input_scope["project_id"], session_id=input_scope["session_id"]
        )
    ] == [second.id]


async def test_admission_rechecks_settlement_under_the_execution_lock(
    input_scope, monkeypatch
):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    executions = SessionExecutionsDAO(engine=input_scope["engine"])
    streams = _SettlementRaceStreams()
    admission_service = SessionInputsService(
        inputs_dao=inputs,
        streams_service=streams,
        executions_dao=executions,
    )
    settlement_service = _settlement_service(input_scope, inputs)
    async with input_scope["engine"].session() as transaction:
        await executions.lock_for_control(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            execution_id="source-turn",
            transaction=transaction,
        )

    admission_task = asyncio.create_task(
        admission_service.admit(
            project_id=input_scope["project_id"],
            user_id=input_scope["user_id"],
            session_id=input_scope["session_id"],
            content={"message": "arrived during settlement"},
            policy="queue",
            idempotency_key="settlement-race",
        )
    )
    await streams.observed_busy.wait()

    assert await settlement_service.settle_execution_completed(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        execution_id="source-turn",
    )
    streams.allow_admission.set()
    admission = await admission_task

    assert admission.action == "execute"
    assert (
        await inputs.list_pending(
            project_id=input_scope["project_id"], session_id=input_scope["session_id"]
        )
        == []
    )


async def test_admission_queues_behind_running_input_promoted_by_settlement(
    input_scope, monkeypatch
):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    older = await inputs.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="older", message="older"),
    )
    executions = SessionExecutionsDAO(engine=input_scope["engine"])
    streams = _SettlementRaceStreams()
    admission_service = SessionInputsService(
        inputs_dao=inputs,
        streams_service=streams,
        executions_dao=executions,
    )
    settlement_service = _settlement_service(input_scope, inputs)
    async with input_scope["engine"].session() as transaction:
        await executions.lock_for_control(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            execution_id="source-turn",
            transaction=transaction,
        )

    admission_task = asyncio.create_task(
        admission_service.admit(
            project_id=input_scope["project_id"],
            user_id=input_scope["user_id"],
            session_id=input_scope["session_id"],
            content={"message": "arrived during settlement"},
            policy="queue",
            idempotency_key="settlement-race",
        )
    )
    await streams.observed_busy.wait()

    assert await settlement_service.settle_execution_completed(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        execution_id="source-turn",
    )
    promoted = await inputs.fetch_input(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        input_id=older.id,
    )
    assert promoted.state == PendingInputState.promoted
    running = await executions.set_state(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        execution_id=promoted.promoted_execution_id,
        state=SessionExecutionState.running,
        expected_states=[SessionExecutionState.recoverable],
    )
    assert running is not None
    assert running.state == SessionExecutionState.running
    assert (
        await inputs.list_pending(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
        )
        == []
    )

    streams.allow_admission.set()
    admission = await admission_task

    assert admission.action == "pending"
    assert admission.execution_id == promoted.promoted_execution_id
    assert [
        item.id
        for item in await inputs.list_pending(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
        )
    ] == [admission.input.id]


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
    command = await _pending_command(input_scope)
    command = await SessionCommandsDAO(engine=input_scope["engine"]).bind_steer_input(
        project_id=input_scope["project_id"],
        command_id=command.id,
        input_id=steer.id,
    )
    assert command is not None
    rebound = await SessionCommandsDAO(engine=input_scope["engine"]).bind_steer_input(
        project_id=input_scope["project_id"],
        command_id=command.id,
        input_id=steer.id,
    )
    rejected = await SessionCommandsDAO(engine=input_scope["engine"]).bind_steer_input(
        project_id=input_scope["project_id"],
        command_id=command.id,
        input_id=older.id,
    )
    assert command.data == {"steer_input_id": str(steer.id)}
    assert rebound is not None and rebound.data == command.data
    assert rejected is None
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


async def test_steer_bind_wins_before_stop_settlement(input_scope, monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    monkeypatch.setattr(
        commands_service_module,
        "get_running_owner",
        AsyncMock(return_value="source-turn"),
    )
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    steer = await inputs.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(
            input_scope, key="steer-first", message="steer first", policy="steer"
        ),
        prioritize=True,
    )
    command = await _pending_command(input_scope)
    bind_executions = _PausingExecutionsDAO(engine=input_scope["engine"])
    bind_service = _cancel_service(input_scope, inputs, executions=bind_executions)
    settlement_commands = _ObservedCommandsDAO(engine=input_scope["engine"])
    settlement_service = _settlement_service(
        input_scope,
        inputs,
        commands=settlement_commands,
        executions=SessionExecutionsDAO(engine=input_scope["engine"]),
    )

    bind_task = asyncio.create_task(
        bind_service.request_cancel(
            project_id=input_scope["project_id"],
            user_id=input_scope["user_id"],
            session_id=input_scope["session_id"],
            expected_execution_id="source-turn",
            steer_input_id=steer.id,
        )
    )
    await asyncio.wait_for(bind_executions.locked.wait(), timeout=5)
    settlement_task = asyncio.create_task(
        settlement_service.settle(
            command_id=command.id,
            project_id=input_scope["project_id"],
            replica_id=None,
            expected_states=[SessionCommandState.pending],
            state=SessionCommandState.applied,
            outcome=SessionCommandOutcome.stopped,
            execution_id="source-turn",
        )
    )
    await asyncio.wait_for(settlement_commands.command_observed.wait(), timeout=5)
    bind_executions.release.set()
    admission, settled = await asyncio.wait_for(
        asyncio.gather(bind_task, settlement_task), timeout=5
    )

    assert admission.command.data == {"steer_input_id": str(steer.id)}
    assert settled is not None
    assert (
        await inputs.fetch_input(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            input_id=steer.id,
        )
    ).state == PendingInputState.promoted


async def test_stop_settlement_wins_before_steer_bind(input_scope, monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    monkeypatch.setattr(
        commands_service_module,
        "get_running_owner",
        AsyncMock(return_value="source-turn"),
    )
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    steer = await inputs.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(
            input_scope,
            key="settlement-first",
            message="settlement first",
            policy="steer",
        ),
        prioritize=True,
    )
    command = await _pending_command(input_scope)
    settlement_executions = _PausingExecutionsDAO(engine=input_scope["engine"])
    settlement_service = _settlement_service(
        input_scope, inputs, executions=settlement_executions
    )
    bind_executions = _ObservedExecutionsDAO(engine=input_scope["engine"])
    bind_service = _cancel_service(input_scope, inputs, executions=bind_executions)

    settlement_task = asyncio.create_task(
        settlement_service.settle(
            command_id=command.id,
            project_id=input_scope["project_id"],
            replica_id=None,
            expected_states=[SessionCommandState.pending],
            state=SessionCommandState.applied,
            outcome=SessionCommandOutcome.stopped,
            execution_id="source-turn",
        )
    )
    await asyncio.wait_for(settlement_executions.locked.wait(), timeout=5)
    bind_task = asyncio.create_task(
        bind_service.request_cancel(
            project_id=input_scope["project_id"],
            user_id=input_scope["user_id"],
            session_id=input_scope["session_id"],
            expected_execution_id="source-turn",
            steer_input_id=steer.id,
        )
    )
    await asyncio.wait_for(bind_executions.lock_attempted.wait(), timeout=5)
    settlement_executions.release.set()

    assert await asyncio.wait_for(settlement_task, timeout=5) is not None
    with pytest.raises(ExecutionExpectationFailed):
        await asyncio.wait_for(bind_task, timeout=5)
    assert (
        await inputs.fetch_input(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            input_id=steer.id,
        )
    ).state == PendingInputState.pending
    settled_command = await SessionCommandsDAO(
        engine=input_scope["engine"]
    ).fetch_command(command_id=command.id)
    assert settled_command.data is None


@pytest.mark.parametrize("policy", ["queue", "steer"])
@pytest.mark.parametrize(
    "state", ["pending_delivery", "running", "recoverable", "terminal"]
)
async def test_admission_follows_approval_continuation_before_stream_header_catches_up(
    input_scope, monkeypatch, policy, state
):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    executions = SessionExecutionsDAO(engine=input_scope["engine"])
    scope = {
        "project_id": input_scope["project_id"],
        "session_id": input_scope["session_id"],
    }
    async with input_scope["engine"].session() as transaction:
        await executions.settle(
            **scope,
            execution_id="source-turn",
            terminal_outcome="continued",
            settled_by="interaction_response",
            transaction=transaction,
        )
        await executions.create_continuation(
            **scope,
            execution_id="approved-child",
            parent_execution_id="source-turn",
            source_interaction_id=None,
            transaction=transaction,
        )
        if state == "terminal":
            await executions.settle(
                **scope,
                execution_id="approved-child",
                terminal_outcome="completed",
                settled_by="runner",
                transaction=transaction,
            )
        else:
            await executions.set_state(
                **scope,
                execution_id="approved-child",
                state=SessionExecutionState(state),
                transaction=transaction,
            )
    service = SessionInputsService(
        inputs_dao=inputs,
        streams_service=_BusyStreams(),
        executions_dao=executions,
    )
    admission = await service.admit(
        **scope,
        user_id=input_scope["user_id"],
        content={"message": "after approved work"},
        policy=policy,
        idempotency_key="approval-start-gap",
    )
    if state == "terminal":
        assert admission.action == "execute"
        assert await inputs.list_pending(**scope) == []
    else:
        assert admission.action == "pending"
        assert admission.execution_id == "approved-child"
        assert len(await inputs.list_pending(**scope)) == 1


@pytest.mark.parametrize("idle", [False, True])
async def test_send_now_preserves_selected_row_and_remaining_order(
    input_scope, monkeypatch, idle
):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    executions = SessionExecutionsDAO(engine=input_scope["engine"])
    service = _cancel_service(input_scope, inputs, executions=executions)
    service._resolve_target = AsyncMock(return_value=("source-turn", None))
    service._reconcile_stopped_redis = AsyncMock()
    rows = []
    for index in range(3):
        values = _input(input_scope, key=f"send-now-{index}", message=str(index))
        values.content["attachments"] = [{"file_id": f"file-{index}"}]
        rows.append(
            await inputs.create_input(
                user_id=input_scope["user_id"], pending_input=values
            )
        )
    if idle:
        await executions.settle(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            execution_id="source-turn",
            terminal_outcome="completed",
            settled_by="runner",
        )
    args = dict(
        project_id=input_scope["project_id"],
        user_id=input_scope["user_id"],
        session_id=input_scope["session_id"],
        input_id=rows[2].id,
    )
    first, second = await asyncio.gather(
        service.send_pending_input_now(**args), service.send_pending_input_now(**args)
    )
    assert first.input.id == second.input.id == rows[2].id
    stored = await inputs.fetch_input(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        input_id=rows[2].id,
    )
    assert stored.content == rows[2].content
    assert stored.idempotency_key == rows[2].idempotency_key
    assert stored.request_fingerprint == rows[2].request_fingerprint
    remaining = await inputs.list_pending(
        project_id=input_scope["project_id"], session_id=input_scope["session_id"]
    )
    assert [item.id for item in remaining if item.id != rows[2].id] == [
        rows[0].id,
        rows[1].id,
    ]
    assert [item.position for item in remaining if item.id != rows[2].id] == [
        rows[0].position,
        rows[1].position,
    ]
    async with input_scope["engine"].session() as transaction:
        commands = (
            (
                await transaction.execute(
                    text(
                        "SELECT kind, data FROM session_commands WHERE project_id=:project_id"
                    ),
                    {"project_id": input_scope["project_id"]},
                )
            )
            .mappings()
            .all()
        )
    assert len(commands) == 1
    assert commands[0]["kind"] == ("continue_input" if idle else "cancel")
    if idle:
        assert stored.state == PendingInputState.promoted
        assert commands[0]["data"]["input_id"] == str(rows[2].id)
        assert (
            commands[0]["data"]["request"]["attachments"]
            == rows[2].content["attachments"]
        )
    else:
        assert stored.state == PendingInputState.pending
        assert remaining[0].id == rows[2].id
        assert commands[0]["data"]["steer_input_id"] == str(rows[2].id)


async def test_send_now_does_not_resurrect_removed_input(input_scope, monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    row = await inputs.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="removed-send-now", message="removed"),
    )
    await inputs.remove_pending(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        input_id=row.id,
        user_id=input_scope["user_id"],
    )
    service = _cancel_service(
        input_scope,
        inputs,
        executions=SessionExecutionsDAO(engine=input_scope["engine"]),
    )
    service._resolve_target = AsyncMock(return_value=("source-turn", None))
    with pytest.raises(SessionInputRemoved, match="removed"):
        await service.send_pending_input_now(
            project_id=input_scope["project_id"],
            user_id=input_scope["user_id"],
            session_id=input_scope["session_id"],
            input_id=row.id,
        )
    async with input_scope["engine"].session() as transaction:
        count = (
            await transaction.execute(
                text(
                    "SELECT count(*) FROM session_commands WHERE project_id=:project_id"
                ),
                {"project_id": input_scope["project_id"]},
            )
        ).scalar_one()
    assert count == 0


async def test_send_now_stop_promotes_selected_once_and_holds_other_rows(
    input_scope, monkeypatch
):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    executions = SessionExecutionsDAO(engine=input_scope["engine"])
    service = _cancel_service(input_scope, inputs, executions=executions)
    service._resolve_target = AsyncMock(return_value=("source-turn", None))
    rows = [
        await inputs.create_input(
            user_id=input_scope["user_id"],
            pending_input=_input(input_scope, key=f"selected-{i}", message=str(i)),
        )
        for i in range(3)
    ]
    args = dict(
        project_id=input_scope["project_id"],
        user_id=input_scope["user_id"],
        session_id=input_scope["session_id"],
        input_id=rows[1].id,
    )
    await service.send_pending_input_now(**args)
    commands = SessionCommandsDAO(engine=input_scope["engine"])
    cancel = await commands.fetch_by_idempotency_key(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        idempotency_key=f"send-now:{rows[1].id}",
    )
    settlement = _settlement_service(input_scope, inputs)
    await settlement.settle(
        command_id=cancel.id,
        project_id=input_scope["project_id"],
        replica_id=None,
        expected_states=[SessionCommandState.pending],
        state=SessionCommandState.applied,
        outcome=SessionCommandOutcome.stopped,
        execution_id="source-turn",
    )
    retry = await service.send_pending_input_now(**args)
    assert retry.input.state == PendingInputState.promoted
    async with input_scope["engine"].session() as transaction:
        continuations = (
            (
                await transaction.execute(
                    text(
                        "SELECT data FROM session_commands WHERE project_id=:project_id AND kind='continue_input'"
                    ),
                    {"project_id": input_scope["project_id"]},
                )
            )
            .scalars()
            .all()
        )
    assert len(continuations) == 1
    assert continuations[0]["input_id"] == str(rows[1].id)
    pending = await inputs.list_pending(
        project_id=input_scope["project_id"], session_id=input_scope["session_id"]
    )
    assert [row.id for row in pending if row.state == PendingInputState.pending] == [
        rows[0].id,
        rows[2].id,
    ]


async def test_competing_send_now_keeps_losing_row_unchanged(input_scope, monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    service = _cancel_service(
        input_scope,
        inputs,
        executions=SessionExecutionsDAO(engine=input_scope["engine"]),
    )
    service._resolve_target = AsyncMock(return_value=("source-turn", None))
    rows = [
        await inputs.create_input(
            user_id=input_scope["user_id"],
            pending_input=_input(input_scope, key=f"compete-{i}", message=str(i)),
        )
        for i in range(2)
    ]
    outcomes = await asyncio.gather(
        *(
            service.send_pending_input_now(
                project_id=input_scope["project_id"],
                user_id=input_scope["user_id"],
                session_id=input_scope["session_id"],
                input_id=row.id,
            )
            for row in rows
        ),
        return_exceptions=True,
    )
    assert sum(isinstance(outcome, SessionInputBusy) for outcome in outcomes) == 1
    loser = rows[
        next(
            i
            for i, outcome in enumerate(outcomes)
            if isinstance(outcome, SessionInputBusy)
        )
    ]
    stored = await inputs.fetch_input(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        input_id=loser.id,
    )
    assert stored.policy == "queue"
    assert stored.position == loser.position
    assert stored.content == loser.content


async def test_send_now_route_rejects_cross_session_and_removed_rows(
    input_scope, monkeypatch
):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    service = _cancel_service(
        input_scope,
        inputs,
        executions=SessionExecutionsDAO(engine=input_scope["engine"]),
    )
    service._resolve_target = AsyncMock(return_value=("source-turn", None))
    row = await inputs.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="route-selected", message="original"),
    )
    router = SessionControlRouter(
        commands_service=service, inputs_service=SimpleNamespace()
    )
    request = SimpleNamespace(
        state=SimpleNamespace(
            project_id=input_scope["project_id"], user_id=input_scope["user_id"]
        )
    )
    with pytest.raises(HTTPException) as missing:
        await router.send_pending_input_now(request, "another-session", row.id)
    assert missing.value.status_code == 404
    await inputs.remove_pending(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        input_id=row.id,
        user_id=input_scope["user_id"],
    )
    with pytest.raises(HTTPException) as removed:
        await router.send_pending_input_now(request, input_scope["session_id"], row.id)
    assert removed.value.status_code == 409
    assert removed.value.detail["code"] == "pending_input_removed"


async def test_send_now_parked_input_continuation_advances_when_runner_not_held(
    input_scope, monkeypatch
):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    monkeypatch.setattr(
        commands_service_module, "get_running_owner", AsyncMock(return_value=None)
    )
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    executions = SessionExecutionsDAO(engine=input_scope["engine"])
    async with input_scope["engine"].session() as transaction:
        await executions.create_continuation(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            execution_id="parked-input-child",
            parent_execution_id="source-turn",
            source_interaction_id=None,
            transaction=transaction,
        )
        await executions.set_state(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            execution_id="parked-input-child",
            state=SessionExecutionState.running,
            transaction=transaction,
        )
    first = await inputs.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="held-first", message="later"),
    )
    selected = await inputs.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="held-selected", message="now"),
    )
    service = _settlement_service(input_scope, inputs, executions=executions)
    service._resolve_target = AsyncMock(return_value=(None, None))
    service._streams.fetch_header = AsyncMock(
        return_value=SimpleNamespace(
            turn_id="parked-input-child", flags=SimpleNamespace(is_running=False)
        )
    )
    service._interactions.cancel_session_pending.return_value = 1

    class ParkedDelivery(_UnreachableDelivery):
        async def deliver(self, *, command):
            return DeliveryReceipt(
                status="not_held"
                if command.kind == SessionCommandKind.cancel
                else "unreachable"
            )

    service._delivery = ParkedDelivery()
    await service.send_pending_input_now(
        project_id=input_scope["project_id"],
        user_id=input_scope["user_id"],
        session_id=input_scope["session_id"],
        input_id=selected.id,
    )
    stored = await inputs.fetch_input(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        input_id=selected.id,
    )
    assert stored.state == PendingInputState.promoted
    pending = await inputs.list_pending(
        project_id=input_scope["project_id"], session_id=input_scope["session_id"]
    )
    assert [row.id for row in pending if row.state == PendingInputState.pending] == [
        first.id
    ]
    service._interactions.cancel_session_pending.assert_any_await(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        only_turn_id="parked-input-child",
        transaction=ANY,
        publish=False,
    )
    async with input_scope["engine"].session() as transaction:
        count = (
            await transaction.execute(
                text(
                    "SELECT count(*) FROM session_commands WHERE project_id=:project_id AND kind='continue_input'"
                ),
                {"project_id": input_scope["project_id"]},
            )
        ).scalar_one()
    assert count == 1


async def test_send_now_reservation_blocks_concurrent_removal(input_scope, monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    inputs = SessionInputsDAO(engine=input_scope["engine"])
    executions = SessionExecutionsDAO(engine=input_scope["engine"])
    service = _cancel_service(input_scope, inputs, executions=executions)
    service._resolve_target = AsyncMock(return_value=("source-turn", None))
    row = await inputs.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="reserved-send-now", message="selected"),
    )
    reserved = asyncio.Event()
    release = asyncio.Event()
    original_prioritize = inputs.prioritize_pending

    async def pause_reserved(**kwargs):
        selected = await original_prioritize(**kwargs)
        reserved.set()
        await release.wait()
        return selected

    monkeypatch.setattr(inputs, "prioritize_pending", pause_reserved)
    args = dict(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        input_id=row.id,
        user_id=input_scope["user_id"],
    )
    sending = asyncio.create_task(service.send_pending_input_now(**args))
    await asyncio.wait_for(reserved.wait(), timeout=5)
    removing = asyncio.create_task(inputs.remove_pending(**args))
    await asyncio.sleep(0)
    release.set()
    admission = await sending
    with pytest.raises(SessionInputNotRemovable):
        await removing
    assert admission.input.id == row.id
    stored = await inputs.fetch_input(
        project_id=args["project_id"], session_id=args["session_id"], input_id=row.id
    )
    assert stored.state == PendingInputState.pending
    assert stored.content == row.content

    async with input_scope["engine"].session() as transaction:
        await transaction.execute(
            text(
                "UPDATE session_commands SET state='claimed' WHERE project_id=:project_id"
            ),
            {"project_id": args["project_id"]},
        )
    with pytest.raises(SessionInputNotRemovable):
        await inputs.remove_pending(**args)
    async with input_scope["engine"].session() as transaction:
        await transaction.execute(
            text(
                "UPDATE session_commands SET state='obsolete', outcome='lost' WHERE project_id=:project_id"
            ),
            {"project_id": args["project_id"]},
        )
    removed = await inputs.remove_pending(**args)
    assert removed.state == PendingInputState.removed


@pytest.mark.asyncio
async def test_edit_pending_preserves_payload_identity_and_retry_attachments(
    input_scope,
):
    dao = SessionInputsDAO(engine=input_scope["engine"])
    service = SessionInputsService(inputs_dao=dao, streams_service=_BusyStreams())
    values = _input(input_scope, key="edit-existing", message="unused")
    values.content = {
        "data": {
            "inputs": {
                "messages": [
                    {"role": "system", "content": "history"},
                    {
                        "id": "user-id",
                        "role": "user",
                        "parts": [
                            {"type": "text", "text": "before"},
                            {
                                "type": "file",
                                "url": "agenta://old",
                                "mediaType": "text/plain",
                                "opaque": True,
                            },
                        ],
                    },
                ]
            },
            "parameters": {"agent": {"instructions": "keep-config"}},
        },
        "references": {"revision": {"id": "keep-revision"}},
    }
    values.request_fingerprint = input_fingerprint(
        content=values.content, policy=values.policy
    )
    row = await dao.create_input(user_id=input_scope["user_id"], pending_input=values)
    update = PendingInputUpdate(
        text="after",
        attachments=[
            PendingInputAttachment(
                uri="agenta://new", mime_type="text/plain", filename="new.txt"
            )
        ],
    )
    for _ in range(2):
        edited = await service.update(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            input_id=row.id,
            user_id=input_scope["user_id"],
            update=update,
        )
    original_retry = await service.admit(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        user_id=input_scope["user_id"],
        content=values.content,
        policy=values.policy,
        idempotency_key=values.idempotency_key,
    )
    assert original_retry.input.id == row.id
    assert original_retry.input.content == edited.content
    assert edited.id == row.id and edited.position == row.position
    assert (
        edited.request_fingerprint == row.request_fingerprint
        and edited.idempotency_key == row.idempotency_key
    )
    assert edited.content["references"] == values.content["references"]
    assert edited.content["data"]["parameters"] == values.content["data"]["parameters"]
    messages = edited.content["data"]["inputs"]["messages"]
    assert messages[0] == values.content["data"]["inputs"]["messages"][0]
    assert messages[1]["id"] == "user-id"
    assert messages[1]["parts"] == [
        {"type": "text", "text": "after"},
        {
            "type": "file",
            "url": "agenta://old",
            "mediaType": "text/plain",
            "opaque": True,
        },
        {
            "type": "file",
            "url": "agenta://new",
            "mediaType": "text/plain",
            "filename": "new.txt",
        },
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("row_state", ["pending", "claimed", "promoted", "removed"])
async def test_edit_pending_rejects_promoted_and_reserved_rows(input_scope, row_state):
    dao = SessionInputsDAO(engine=input_scope["engine"])
    service = SessionInputsService(inputs_dao=dao, streams_service=_BusyStreams())
    row = await dao.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="edit-reserved", message="original"),
    )
    if row_state in ("pending", "claimed"):
        await _pending_command(input_scope, data={"steer_input_id": str(row.id)})
        if row_state == "claimed":
            async with input_scope["engine"].session() as tx:
                await tx.execute(
                    text(
                        "UPDATE session_commands SET state='claimed' WHERE project_id=:project"
                    ),
                    {"project": input_scope["project_id"]},
                )
    else:
        async with input_scope["engine"].session() as tx:
            await tx.execute(
                text("UPDATE session_inputs SET state=:state WHERE id=:id"),
                {"state": row_state, "id": row.id},
            )
    with pytest.raises(SessionInputNotEditable):
        await service.update(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            input_id=row.id,
            user_id=input_scope["user_id"],
            update=PendingInputUpdate(text="changed"),
        )
    stored = await dao.fetch_input(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        input_id=row.id,
    )
    assert stored.content == row.content


@pytest.mark.asyncio
async def test_promotion_waits_for_edited_head_instead_of_skipping_it(input_scope):
    dao = SessionInputsDAO(engine=input_scope["engine"])
    first = await dao.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="edit-first", message="first"),
    )
    await dao.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="edit-second", message="second"),
    )
    async with dao.transaction() as tx:
        await dao.lock_pending_for_edit(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            input_id=first.id,
            transaction=tx,
        )
        promotion = asyncio.create_task(
            dao.promote_next(
                project_id=input_scope["project_id"],
                session_id=input_scope["session_id"],
                execution_id="next",
            )
        )
        await asyncio.sleep(0.05)
        assert not promotion.done()
        await dao.update_content(
            project_id=input_scope["project_id"],
            session_id=input_scope["session_id"],
            input_id=first.id,
            content={"edited": "head"},
            user_id=input_scope["user_id"],
            transaction=tx,
        )
    promoted = await asyncio.wait_for(promotion, 2)
    assert promoted.id == first.id
    assert promoted.content == {"edited": "head"}


@pytest.mark.asyncio
async def test_edit_pending_scope_and_invalid_content_leave_row_unchanged(input_scope):
    dao = SessionInputsDAO(engine=input_scope["engine"])
    service = SessionInputsService(inputs_dao=dao, streams_service=_BusyStreams())
    row = await dao.create_input(
        user_id=input_scope["user_id"],
        pending_input=_input(input_scope, key="invalid-edit", message="opaque"),
    )
    args = dict(
        project_id=input_scope["project_id"],
        session_id=input_scope["session_id"],
        input_id=row.id,
        user_id=input_scope["user_id"],
        update=PendingInputUpdate(text="new"),
    )
    with pytest.raises(SessionInputNotFound):
        await service.update(**{**args, "project_id": uuid.uuid4()})
    with pytest.raises(SessionInputContentInvalid):
        await service.update(**args)
    stored = await dao.fetch_input(
        project_id=args["project_id"], session_id=args["session_id"], input_id=row.id
    )
    assert stored.content == row.content


@pytest.mark.parametrize(
    "original",
    [
        "before",
        [
            {"type": "text", "text": "before"},
            {"type": "attachment", "uri": "agenta://old", "opaque": True},
        ],
    ],
)
def test_edit_pending_canonical_content_keeps_attachments(original):
    content = {
        "data": {"inputs": {"messages": [{"role": "user", "content": original}]}}
    }
    update = PendingInputUpdate(
        text="after",
        attachments=[
            PendingInputAttachment(uri="agenta://new", mime_type="text/plain")
        ],
    )
    edited = edit_pending_input_content(content, update)
    assert edit_pending_input_content(edited, update) == edited
    blocks = edited["data"]["inputs"]["messages"][0]["content"]
    assert blocks[0] == {"type": "text", "text": "after"}
    assert blocks[-1] == {
        "type": "attachment",
        "uri": "agenta://new",
        "mime_type": "text/plain",
    }
    if isinstance(original, list):
        assert blocks[1] == original[1]
    assert content["data"]["inputs"]["messages"][0]["content"] == original
