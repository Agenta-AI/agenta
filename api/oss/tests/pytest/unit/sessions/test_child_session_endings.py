"""The parts of M10 outside the producer: the second turn-ended stream, the kill of a
running turn (design D27), the `cancel_session` cause, and the server-owned
`calling_turn_id` of a child input."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from oss.src.core.sessions.commands.dtos import (
    SessionCommand,
    SessionCommandKind,
    SessionCommandState,
)
from oss.src.core.sessions.commands.service import (
    SessionCommandsService,
    steer_cancel_key,
)
from oss.src.core.sessions.executions.dtos import (
    SessionExecutionSettlement,
    SessionExecutionSettlementResult,
    SessionExecutionState,
)
from oss.src.core.sessions.inputs.dtos import PendingInputCreate, PendingInputKind
from oss.src.core.sessions.inputs.service import SessionInputsService
from oss.src.dbs.postgres.sessions.inputs.mappings import (
    new_input_row,
    to_pending_input,
)
from oss.src.tasks.asyncio.sessions import streaming
from oss.tests.pytest.unit.sessions.test_pending_inputs_service import (
    MemoryInputsDAO,
)
from oss.tests.pytest.utils.principals import make_envelope

PROJECT_ID = uuid4()
SESSION_ID = "blog-writer-child"
EXECUTION_ID = str(uuid4())


# --- 4.1: both streams get the turn-ended signal --------------------------------------


class _Redis:
    def __init__(self, *, fail_on=None):
        self.calls = []
        self.fail_on = fail_on

    async def xadd(self, *, name, fields, maxlen, approximate):
        if name == self.fail_on:
            raise ConnectionError("redis down")
        self.calls.append(name)


@pytest.mark.asyncio
async def test_a_turn_ended_signal_goes_to_both_streams(monkeypatch):
    redis = _Redis()
    monkeypatch.setattr(streaming, "_get_redis", lambda: redis)

    published = await streaming.publish_turn_ended(
        project_id=PROJECT_ID, session_id=SESSION_ID, turn_id=EXECUTION_ID
    )

    assert published is True
    assert redis.calls == ["streams:sessions", "streams:session-turn-ends"]


@pytest.mark.asyncio
async def test_a_turn_started_signal_goes_only_to_the_sessions_stream(monkeypatch):
    redis = _Redis()
    monkeypatch.setattr(streaming, "_get_redis", lambda: redis)

    await streaming.publish_turn_started(
        project_id=PROJECT_ID, session_id=SESSION_ID, turn_id=EXECUTION_ID
    )

    assert redis.calls == ["streams:sessions"]


@pytest.mark.asyncio
async def test_a_failed_write_to_the_second_stream_fails_the_publish(monkeypatch):
    """The records worker then holds the batch, as for the first stream."""
    redis = _Redis(fail_on="streams:session-turn-ends")
    monkeypatch.setattr(streaming, "_get_redis", lambda: redis)

    published = await streaming.publish_turn_ended(
        project_id=PROJECT_ID, session_id=SESSION_ID, turn_id=EXECUTION_ID
    )

    assert published is False


# --- 4.7: the kill settles the running execution --------------------------------------


class _Executions:
    def __init__(self, outcome=None):
        self.row = SessionExecutionSettlement(
            project_id=PROJECT_ID,
            session_id=SESSION_ID,
            execution_id=EXECUTION_ID,
            state=SessionExecutionState.running,
            terminal_outcome=outcome,
        )
        self.settles = []

    async def settle(self, **kwargs):
        self.settles.append(kwargs)
        if self.row.terminal_outcome is not None:
            return SessionExecutionSettlementResult(settlement=self.row, won=False)
        self.row = self.row.model_copy(
            update={
                "terminal_outcome": kwargs["terminal_outcome"],
                "settled_by": kwargs["settled_by"],
                "state": SessionExecutionState.terminal,
            }
        )
        return SessionExecutionSettlementResult(settlement=self.row, won=True)


class _CommandsDAO:
    def __init__(self, command=None):
        self.command = command

    @asynccontextmanager
    async def transaction(self):
        yield SimpleNamespace()

    async def fetch_turn_cancel(self, *, project_id, session_id, target_turn_id):
        return self.command


def _commands(executions=None, command=None) -> SessionCommandsService:
    return SessionCommandsService(
        commands_dao=_CommandsDAO(command),
        streams_service=None,
        interactions_service=None,
        lock_engine=None,
        delivery=None,
        executions_dao=executions,
        inputs_dao=AsyncMock(),
    )


@pytest.mark.asyncio
async def test_a_kill_settles_the_running_execution_stopped_by_the_watchdog():
    executions = _Executions()
    service = _commands(executions)
    service._promote_next_input = AsyncMock()

    settled = await service.settle_execution_killed(
        project_id=PROJECT_ID, session_id=SESSION_ID, execution_id=EXECUTION_ID
    )

    assert settled is True
    assert executions.row.terminal_outcome == "stopped"
    assert executions.row.settled_by == "watchdog"
    # No queued input of the ended session is promoted.
    service._promote_next_input.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_kill_after_a_runner_ending_settles_nothing():
    executions = _Executions(outcome="completed")
    service = _commands(executions)

    settled = await service.settle_execution_killed(
        project_id=PROJECT_ID, session_id=SESSION_ID, execution_id=EXECUTION_ID
    )

    assert settled is False
    assert executions.row.terminal_outcome == "completed"


class _StreamsService:
    def __init__(self, *, running):
        self.running = running
        self.killed = False

    async def fetch(self, *, project_id, session_id):
        return SimpleNamespace(
            turn_id=EXECUTION_ID, flags=SimpleNamespace(is_running=self.running)
        )

    async def kill(self, **_kwargs):
        self.killed = True
        return True


async def _kill_route(*, running: bool):
    from oss.src.apis.fastapi.sessions import router as router_module

    commands = AsyncMock()
    streams = _StreamsService(running=running)
    interactions = AsyncMock()
    route = router_module.SessionStreamsRouter(
        service=streams,
        interactions_service=interactions,
        run_admission=AsyncMock(),
        commands_service=commands,
    )
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=str(PROJECT_ID), user_id=str(uuid4()))
    )
    return route, request, commands, streams, router_module


@pytest.mark.asyncio
async def test_the_kill_route_settles_the_execution_that_ran(monkeypatch):
    route, request, commands, streams, module = await _kill_route(running=True)
    monkeypatch.setattr(module, "check_action_access", AsyncMock(return_value=True))
    monkeypatch.setattr(module, "allow_resource", AsyncMock(return_value=True))
    monkeypatch.setattr(module, "prefetch_session", lambda *a, **k: None)

    await route.delete_session_stream(request, session_id=SESSION_ID)

    assert streams.killed
    commands.settle_execution_killed.assert_awaited_once_with(
        project_id=PROJECT_ID, session_id=SESSION_ID, execution_id=EXECUTION_ID
    )


@pytest.mark.asyncio
async def test_a_failed_settle_leaves_the_session_for_a_retry_of_the_kill(monkeypatch):
    route, request, commands, streams, module = await _kill_route(running=True)
    monkeypatch.setattr(module, "check_action_access", AsyncMock(return_value=True))
    monkeypatch.setattr(module, "allow_resource", AsyncMock(return_value=True))
    monkeypatch.setattr(module, "prefetch_session", lambda *a, **k: None)
    commands.settle_execution_killed.side_effect = RuntimeError("database down")

    # The route answers 500, and the row is not soft-deleted yet, so a retry still
    # finds the running execution.
    with pytest.raises(HTTPException):
        await route.delete_session_stream(request, session_id=SESSION_ID)

    assert not streams.killed


@pytest.mark.asyncio
async def test_the_kill_of_an_idle_session_settles_nothing(monkeypatch):
    route, request, commands, streams, module = await _kill_route(running=False)
    monkeypatch.setattr(module, "check_action_access", AsyncMock(return_value=True))
    monkeypatch.setattr(module, "allow_resource", AsyncMock(return_value=True))
    monkeypatch.setattr(module, "prefetch_session", lambda *a, **k: None)

    await route.delete_session_stream(request, session_id=SESSION_ID)

    assert streams.killed
    commands.settle_execution_killed.assert_not_awaited()


# --- 4.6: the cancel cause -----------------------------------------------------------


def _cancel(*, key, data):
    return SessionCommand(
        id=uuid4(),
        project_id=PROJECT_ID,
        session_id=SESSION_ID,
        kind=SessionCommandKind.cancel,
        target_turn_id=EXECUTION_ID,
        state=SessionCommandState.applied,
        idempotency_key=key,
        data=data,
    )


@pytest.mark.parametrize(
    "command, cause",
    [
        (None, None),
        (_cancel(key="stop-click", data=None), None),
        (
            _cancel(
                key=steer_cancel_key("input-1"), data={"steer_input_id": "input-1"}
            ),
            "steer",
        ),
        (
            _cancel(key="cancel-tool-1", data={"cancelled_by": "calling_session"}),
            "calling_session",
        ),
    ],
)
@pytest.mark.asyncio
async def test_the_cancel_cause(command, cause):
    service = _commands(command=command)

    assert (
        await service.cancel_cause(
            project_id=PROJECT_ID, session_id=SESSION_ID, execution_id=EXECUTION_ID
        )
        == cause
    )
    assert await service.cancelled_by_steer(
        project_id=PROJECT_ID, session_id=SESSION_ID, execution_id=EXECUTION_ID
    ) is (cause == "steer")


# --- calling_turn_id: stored, never returned -----------------------------------------


@pytest.mark.asyncio
async def test_a_queued_child_input_stores_the_calling_turn_id():
    dao = MemoryInputsDAO()
    service = SessionInputsService(inputs_dao=dao, streams_service=AsyncMock())
    envelope = make_envelope(project_id=PROJECT_ID, origin="calling_session")

    item = await service.queue_input(
        project_id=PROJECT_ID,
        user_id=uuid4(),
        session_id=SESSION_ID,
        content={"session_id": SESSION_ID},
        idempotency_key="ag:send:caller:x:call-1",
        envelope=envelope,
        kind=PendingInputKind.message,
        calling_turn_id="calling-turn-1",
    )

    assert item.calling_turn_id == "calling-turn-1"
    assert "calling_turn_id" not in item.model_dump()
    assert "calling_turn_id" not in item.model_dump(mode="json")


def test_the_column_round_trips_through_the_row_mapping():
    row = new_input_row(
        user_id=uuid4(),
        pending_input=PendingInputCreate(
            project_id=PROJECT_ID,
            session_id=SESSION_ID,
            content={"session_id": SESSION_ID},
            policy="queue",
            idempotency_key="ag:start:caller:x:call-1",
            request_fingerprint="f",
            calling_turn_id="calling-turn-1",
        ),
        position=1,
    )
    assert row.calling_turn_id == "calling-turn-1"
    row.id = uuid4()
    row.state = "pending"

    assert to_pending_input(row).calling_turn_id == "calling-turn-1"


@pytest.mark.asyncio
async def test_start_once_passes_the_calling_turn_id_to_the_first_input():
    from oss.tests.pytest.unit.sessions import test_session_start_service as starts

    inputs = AsyncMock()
    executions = AsyncMock()

    async def claim(**kwargs):
        return starts._input(kwargs["content"]).model_copy(
            update={
                "session_id": kwargs["session_id"],
                "promoted_execution_id": kwargs["execution_id"],
            }
        )

    inputs.claim_for_execution.side_effect = claim
    executions.fetch_execution.side_effect = [
        None,
        starts._execution("stored-session", "stored-execution"),
    ]
    service = starts._service(inputs=inputs, executions=executions)

    await service.start_once(**starts._args(), calling_turn_id="calling-turn-1")

    assert (
        inputs.claim_for_execution.await_args.kwargs["calling_turn_id"]
        == "calling-turn-1"
    )


# --- QA D6: the deprecated Stop records the durable cancel command --------------------


class _StopStreamsService(_StreamsService):
    def __init__(self, *, running, order, turn_started_at=None):
        super().__init__(running=running)
        self.order = order
        self.turn_started_at = turn_started_at

    async def fetch(self, *, project_id, session_id):
        return SimpleNamespace(
            turn_id=EXECUTION_ID,
            turn_started_at=self.turn_started_at,
            flags=SimpleNamespace(is_running=self.running),
        )

    async def clock_ms(self):
        return 1_000_000

    async def command(self, **_kwargs):
        self.order.append("stop")
        return SimpleNamespace(
            session_id=SESSION_ID,
            cancelled_turn_ids=[EXECUTION_ID] if self.running else [],
        )


async def _stop_route(
    monkeypatch,
    *,
    running: bool,
    expected_execution_id=None,
    turn_started_at=None,
    session_missing: bool = False,
):
    from oss.src.apis.fastapi.sessions import router as router_module
    from oss.src.core.sessions.streams.dtos import SessionStreamCommandRequest

    order: list = []
    commands = AsyncMock()
    commands.request_cancel.side_effect = lambda **_kwargs: order.append("command")
    streams = _StopStreamsService(
        running=running, order=order, turn_started_at=turn_started_at
    )
    route = router_module.SessionStreamsRouter(
        service=streams,
        interactions_service=AsyncMock(),
        run_admission=AsyncMock(),
        commands_service=commands,
    )
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=str(PROJECT_ID), user_id=str(uuid4()))
    )
    monkeypatch.setattr(router_module, "allow_resource", AsyncMock(return_value=True))
    monkeypatch.setattr(
        router_module,
        "session_recheck",
        lambda *a, **k: SimpleNamespace(checked=True),
    )
    monkeypatch.setattr(
        router_module, "session_was_missing", lambda **_k: session_missing
    )
    monkeypatch.setattr(router_module, "policy_for_request", lambda *a, **k: None)
    monkeypatch.setattr(router_module, "request_run_envelope", lambda *a, **k: None)
    payload = SessionStreamCommandRequest(
        session_id=SESSION_ID, expected_execution_id=expected_execution_id
    )
    return route, request, payload, commands, order


@pytest.mark.asyncio
async def test_a_stop_of_a_running_turn_records_the_durable_cancel_first(monkeypatch):
    # With the command, the abandoned-command sweep settles the turn when the runner is
    # gone, and the sweep writes the missing `done`; before, this Stop left no trace.
    route, request, payload, commands, order = await _stop_route(
        monkeypatch, running=True
    )

    await route.set_session_stream(request, payload=payload)

    assert order == ["command", "stop"]
    kwargs = commands.request_cancel.await_args.kwargs
    assert kwargs["project_id"] == PROJECT_ID
    assert kwargs["session_id"] == SESSION_ID
    assert kwargs["expected_execution_id"] == EXECUTION_ID


@pytest.mark.asyncio
async def test_a_stop_of_an_idle_session_records_no_command(monkeypatch):
    route, request, payload, commands, order = await _stop_route(
        monkeypatch, running=False
    )

    await route.set_session_stream(request, payload=payload)

    assert order == ["stop"]
    commands.request_cancel.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_stop_after_the_turn_ended_still_stops(monkeypatch):
    from oss.src.core.sessions.commands.types import ExecutionExpectationFailed

    route, request, payload, commands, order = await _stop_route(
        monkeypatch, running=True
    )
    commands.request_cancel.side_effect = ExecutionExpectationFailed(
        expected=EXECUTION_ID, current=None
    )

    await route.set_session_stream(request, payload=payload)

    assert order == ["stop"]


# --- QA D3: the producer resolves a static calling agent ------------------------------


@pytest.mark.asyncio
async def test_the_producer_workflows_service_resolves_a_static_agent(monkeypatch):
    # The Builder is a static workflow with no row. Without the static catalog, the run
    # admission of every child update to a Builder session raised
    # `AgentReferenceUnresolved`, and no update was written.
    from entrypoints import session_child_updates as composition
    from oss.src.core.sessions.types import SessionReference
    from oss.src.core.workflows.build_kit import BUILD_KIT_WORKFLOW_SLUG
    from oss.src.core.workflows.static_catalog import StaticWorkflowCatalog

    monkeypatch.setattr(composition, "get_lock_engine", lambda: AsyncMock())
    workflows_service, _ = composition._workflows_service(
        transactions_engine=AsyncMock(), mounts_store=AsyncMock()
    )
    workflows_service.workflows_dao = AsyncMock()

    artifact_id = await workflows_service.resolve_agent_artifact_id(
        project_id=PROJECT_ID,
        references=[SessionReference(key="workflow", slug=BUILD_KIT_WORKFLOW_SLUG)],
    )

    static = StaticWorkflowCatalog().retrieve_revision(slug=BUILD_KIT_WORKFLOW_SLUG)
    assert artifact_id == (static.artifact_id or static.workflow_id)
    assert workflows_service.workflows_dao.method_calls == []


@pytest.mark.asyncio
async def test_a_stop_that_names_another_turn_records_no_command(monkeypatch):
    # The stop below refuses a Stop that names an older turn; the command must not
    # cancel the turn that runs now in its place.
    route, request, payload, commands, order = await _stop_route(
        monkeypatch, running=True, expected_execution_id="older-turn"
    )

    await route.set_session_stream(request, payload=payload)

    assert order == ["stop"]
    commands.request_cancel.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_stop_records_no_command_for_a_turn_that_started_after_it(monkeypatch):
    route, request, payload, commands, order = await _stop_route(
        monkeypatch,
        running=True,
        # After the request arrived (the stub clock says 1_000_000 ms).
        turn_started_at=datetime.fromtimestamp(2_000, tz=timezone.utc),
    )

    await route.set_session_stream(request, payload=payload)

    assert order == ["stop"]
    commands.request_cancel.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_stop_whose_route_check_found_no_row_records_no_command(monkeypatch):
    route, request, payload, commands, order = await _stop_route(
        monkeypatch, running=True, session_missing=True
    )

    await route.set_session_stream(request, payload=payload)

    assert order == ["stop"]
    commands.request_cancel.assert_not_awaited()
