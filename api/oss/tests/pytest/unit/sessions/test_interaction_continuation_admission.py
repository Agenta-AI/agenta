from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.sessions.commands.dtos import (
    SessionCommand,
    SessionCommandKind,
    SessionCommandOutcome,
    SessionCommandState,
)
from oss.src.core.sessions.commands.interfaces import DeliveryReceipt
from oss.src.core.sessions.commands.service import SessionCommandsService
from oss.src.core.sessions.commands.types import IdempotencyKeyReused
from oss.src.utils.env import env
from oss.src.core.sessions.executions.dtos import (
    SessionExecutionSettlement,
    SessionExecutionSettlementResult,
    SessionExecutionState,
)
from oss.src.core.sessions.interactions.dtos import (
    SessionInteraction,
    SessionInteractionData,
    SessionInteractionKind,
    SessionInteractionStatus,
)


class _Commands:
    def __init__(self):
        self.command = None
        self.abandoned = []

    @asynccontextmanager
    async def transaction(self):
        yield object()

    async def fetch_by_idempotency_key(self, **kwargs):
        return self.command

    async def fetch_command(self, **kwargs):
        return self.command

    async def create_command(self, *, user_id, command, transaction=None, **kwargs):
        self.command = SessionCommand(
            id=uuid4(),
            project_id=command.project_id,
            session_id=command.session_id,
            kind=command.kind,
            target_turn_id=command.target_turn_id,
            expected_turn_id=command.expected_turn_id,
            data=command.data,
            state=command.state,
            idempotency_key=command.idempotency_key,
            created_at=datetime.now(timezone.utc),
        )
        return self.command

    async def record_delivery_attempt(self, **kwargs):
        return self.command

    async def claim_for_delivery(self, **kwargs):
        return self.command

    async def fetch_resumable_continuation(self, **kwargs):
        if self.command and (
            self.command.state
            in (
                SessionCommandState.pending,
                SessionCommandState.claimed,
            )
            or (
                self.command.state == SessionCommandState.obsolete
                and self.command.outcome
                in (SessionCommandOutcome.lost, SessionCommandOutcome.failed)
            )
            or (
                self.command.state == SessionCommandState.applied
                and self.command.outcome == SessionCommandOutcome.started
            )
        ):
            return self.command
        return None

    async def reopen_continuation(self, **kwargs):
        self.command = self.command.model_copy(
            update={
                "target_turn_id": kwargs["replacement_turn_id"],
                "state": SessionCommandState.pending,
                "outcome": None,
                "claimed_by": None,
                "settled_at": None,
                "claim_count": 0,
            }
        )
        return self.command

    async def expire_claims(self, **kwargs):
        return self.abandoned

    async def settle_command(self, *, settle, **kwargs):
        if self.command is None or self.command.state not in settle.expected_states:
            return None
        self.command = self.command.model_copy(
            update={
                "state": settle.state,
                "outcome": settle.outcome,
                **({"claimed_by": settle.replica_id} if settle.replica_id else {}),
            }
        )
        return self.command


@pytest.fixture(autouse=True)
def _durable_stop_enabled(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)


class _Interactions:
    def __init__(self, interaction):
        self.interaction = interaction

    async def fetch_interaction(self, **kwargs):
        return self.interaction

    async def transition_interaction(self, *, transition, **kwargs):
        data = self.interaction.data or SessionInteractionData()
        self.interaction = self.interaction.model_copy(
            update={
                "status": transition.status,
                "data": data.model_copy(update={"resolution": transition.resolution}),
            }
        )
        return self.interaction

    async def publish_interaction_responded(self, **kwargs):
        return None


class _Executions:
    def __init__(self, *, project_id, session_id, source_id):
        self.source = SessionExecutionSettlement(
            project_id=project_id,
            session_id=session_id,
            execution_id=source_id,
            state=SessionExecutionState.active,
        )
        self.continuation = SessionExecutionSettlement(
            project_id=project_id,
            session_id=session_id,
            execution_id="continuation-1",
            state=SessionExecutionState.recoverable,
            source_interaction_id=uuid4(),
        )
        self.states = []

    async def fetch_execution(self, **kwargs):
        if kwargs["execution_id"] == self.source.execution_id:
            return self.source
        if kwargs["execution_id"] == self.continuation.execution_id:
            return self.continuation
        return None

    async def lock_for_control(self, **kwargs):
        execution = await self.fetch_execution(**kwargs)
        assert execution is not None
        return execution

    async def settle(self, **kwargs):
        current = (
            self.source
            if kwargs["execution_id"] == self.source.execution_id
            else self.continuation
        )
        settled = current.model_copy(
            update={
                "state": SessionExecutionState.terminal,
                "terminal_outcome": kwargs["terminal_outcome"],
                "settled_by": kwargs["settled_by"],
                "settled_at": datetime.now(timezone.utc),
            }
        )
        if current is self.source:
            self.source = settled
        else:
            self.continuation = settled
        return SessionExecutionSettlementResult(settlement=settled, won=True)

    async def create_continuation(self, **kwargs):
        self.continuation = SessionExecutionSettlement(
            project_id=kwargs["project_id"],
            session_id=kwargs["session_id"],
            execution_id=kwargs["execution_id"],
            state=SessionExecutionState.pending_delivery,
            parent_execution_id=kwargs["parent_execution_id"],
            source_interaction_id=kwargs["source_interaction_id"],
        )
        return self.continuation

    async def set_state(self, **kwargs):
        self.states.append((kwargs["execution_id"], kwargs["state"], kwargs["error"]))
        current = (
            self.source
            if kwargs["execution_id"] == self.source.execution_id
            else self.continuation
        )
        expected = kwargs.get("expected_states")
        if expected is not None and current.state not in expected:
            return None
        updated = current.model_copy(
            update={"state": kwargs["state"], "error": kwargs["error"]}
        )
        if current is self.source:
            self.source = updated
        else:
            self.continuation = updated
        return updated


class _Unreachable:
    def __init__(self):
        self.delivered = []

    async def deliver(self, **kwargs):
        self.delivered.append(kwargs["command"])
        return DeliveryReceipt(status="unreachable", detail="runner unavailable")

    async def acknowledge(self, **kwargs):
        return None


@pytest.mark.asyncio
async def test_delivery_failure_keeps_answer_and_continuation_recoverable():
    project_id = uuid4()
    user_id = uuid4()
    interaction_id = uuid4()
    interaction = SessionInteraction(
        id=interaction_id,
        project_id=project_id,
        session_id="session-1",
        turn_id="source-1",
        token="approval-1",
        kind=SessionInteractionKind.user_approval,
        status=SessionInteractionStatus.pending,
    )
    commands = _Commands()
    interactions = _Interactions(interaction)
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    delivery = _Unreachable()
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=None,
        interactions_service=interactions,
        lock_engine=None,
        delivery=delivery,
        executions_dao=executions,
    )

    admission = await service.respond_interaction(
        project_id=project_id,
        user_id=user_id,
        interaction_id=interaction_id,
        answer={"approved": True},
        expected_execution_id="source-1",
        idempotency_key="response-1",
    )

    assert admission.interaction.status == SessionInteractionStatus.responded
    assert admission.execution_state == SessionExecutionState.recoverable
    assert commands.command.data == {
        "interaction_id": str(interaction_id),
        "continuation_execution_id": admission.execution_id,
    }
    assert delivery.delivered[0].data["answer"] == {"approved": True}
    assert executions.source.terminal_outcome == "continued"
    assert executions.states[-1][1] == SessionExecutionState.recoverable

    retry = await service.respond_interaction(
        project_id=project_id,
        user_id=user_id,
        interaction_id=interaction_id,
        answer={"approved": True},
        expected_execution_id="source-1",
        idempotency_key="response-1",
    )
    assert retry.command.id == admission.command.id
    assert retry.execution_id == admission.execution_id

    with pytest.raises(IdempotencyKeyReused):
        await service.respond_interaction(
            project_id=project_id,
            user_id=user_id,
            interaction_id=interaction_id,
            answer={"approved": False},
            expected_execution_id="source-1",
            idempotency_key="response-1",
        )


@pytest.mark.asyncio
async def test_post_commit_failures_do_not_reject_an_accepted_answer():
    project_id = uuid4()
    interaction_id = uuid4()
    interaction = SessionInteraction(
        id=interaction_id,
        project_id=project_id,
        session_id="session-1",
        turn_id="source-1",
        token="approval-1",
        kind=SessionInteractionKind.user_approval,
        status=SessionInteractionStatus.pending,
    )
    commands = _Commands()
    interactions = _Interactions(interaction)
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    interactions.publish_interaction_responded = AsyncMock(
        side_effect=RuntimeError("watch unavailable")
    )
    commands.record_delivery_attempt = AsyncMock(
        side_effect=RuntimeError("attempt write unavailable")
    )
    executions.set_state = AsyncMock(
        side_effect=RuntimeError("recoverable projection unavailable")
    )
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=None,
        interactions_service=interactions,
        lock_engine=None,
        delivery=_Unreachable(),
        executions_dao=executions,
    )

    admission = await service.respond_interaction(
        project_id=project_id,
        user_id=uuid4(),
        interaction_id=interaction_id,
        answer={"approved": True},
        expected_execution_id="source-1",
        idempotency_key="response-1",
    )

    assert admission.interaction.status == SessionInteractionStatus.responded
    assert admission.execution_state == SessionExecutionState.recoverable


def _continuation_command(project_id, interaction_id, *, claim_count=1):
    return SessionCommand(
        id=uuid4(),
        project_id=project_id,
        session_id="session-1",
        kind=SessionCommandKind.continue_interaction,
        target_turn_id="continuation-1",
        expected_turn_id="source-1",
        data={
            "interaction_id": str(interaction_id),
            "continuation_execution_id": "continuation-1",
        },
        state=SessionCommandState.pending,
        claim_count=claim_count,
        created_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_sweep_redelivers_continuation_without_a_heartbeat():
    project_id = uuid4()
    interaction_id = uuid4()
    interaction = SessionInteraction(
        id=interaction_id,
        project_id=project_id,
        session_id="session-1",
        turn_id="source-1",
        token="approval-1",
        kind=SessionInteractionKind.user_approval,
        status=SessionInteractionStatus.responded,
        data=SessionInteractionData(resolution={"approved": True}),
    )
    commands = _Commands()
    commands.command = _continuation_command(project_id, interaction_id)
    commands.abandoned = [commands.command]
    delivery = _Unreachable()
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=None,
        interactions_service=_Interactions(interaction),
        lock_engine=None,
        delivery=delivery,
        executions_dao=_Executions(
            project_id=project_id, session_id="session-1", source_id="source-1"
        ),
    )

    settled = await service.settle_abandoned_commands(now=datetime.now(timezone.utc))

    assert settled == 0
    assert [item.id for item in delivery.delivered] == [commands.command.id]


@pytest.mark.asyncio
async def test_next_send_resumes_the_same_open_continuation():
    project_id = uuid4()
    interaction_id = uuid4()
    interaction = SessionInteraction(
        id=interaction_id,
        project_id=project_id,
        session_id="session-1",
        turn_id="source-1",
        token="approval-1",
        kind=SessionInteractionKind.user_approval,
        status=SessionInteractionStatus.responded,
        data=SessionInteractionData(resolution={"approved": True}),
    )
    commands = _Commands()
    commands.command = _continuation_command(project_id, interaction_id)
    delivery = _Unreachable()
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=None,
        interactions_service=_Interactions(interaction),
        lock_engine=None,
        delivery=delivery,
        executions_dao=_Executions(
            project_id=project_id, session_id="session-1", source_id="source-1"
        ),
    )

    resumed = await service.resume_recoverable_continuation(
        project_id=project_id, session_id="session-1"
    )

    assert resumed is True
    assert delivery.delivered[0].id == commands.command.id
    assert delivery.delivered[0].target_turn_id == "continuation-1"


@pytest.mark.asyncio
async def test_exhausted_continuation_stays_recoverable(monkeypatch):
    maximum = 2
    monkeypatch.setattr(env.agenta.sessions.commands, "max_deliveries", maximum)
    project_id = uuid4()
    interaction_id = uuid4()
    command = _continuation_command(project_id, interaction_id, claim_count=maximum)
    commands = _Commands()
    commands.command = command
    commands.abandoned = [command]
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    delivery = _Unreachable()
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=None,
        interactions_service=_Interactions(
            SessionInteraction(
                id=interaction_id,
                project_id=project_id,
                session_id="session-1",
                turn_id="source-1",
                token="approval-1",
                kind=SessionInteractionKind.user_approval,
                status=SessionInteractionStatus.responded,
                data=SessionInteractionData(resolution={"approved": True}),
            )
        ),
        lock_engine=None,
        delivery=delivery,
        executions_dao=executions,
    )

    settled = await service.settle_abandoned_commands(now=datetime.now(timezone.utc))

    assert settled == 1
    assert commands.command.state == SessionCommandState.obsolete
    assert executions.states[-1][1] == SessionExecutionState.recoverable

    resumed = await service.resume_recoverable_continuation(
        project_id=project_id, session_id="session-1"
    )
    assert resumed is True
    assert commands.command.state == SessionCommandState.pending
    assert delivery.delivered[-1].id == command.id
    assert delivery.delivered[-1].target_turn_id != "continuation-1"
    assert executions.continuation.execution_id == delivery.delivered[-1].target_turn_id
    assert executions.continuation.parent_execution_id == "continuation-1"
    assert executions.continuation.source_interaction_id is None


@pytest.mark.asyncio
async def test_only_the_winning_started_outcome_is_admitted():
    project_id = uuid4()
    interaction_id = uuid4()
    commands = _Commands()
    commands.command = _continuation_command(project_id, interaction_id)
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=None,
        interactions_service=_Interactions(
            SessionInteraction(
                id=interaction_id,
                project_id=project_id,
                session_id="session-1",
                turn_id="source-1",
                token="approval-1",
                kind=SessionInteractionKind.user_approval,
                status=SessionInteractionStatus.responded,
                data=SessionInteractionData(resolution={"approved": True}),
            )
        ),
        lock_engine=None,
        delivery=_Unreachable(),
        executions_dao=executions,
    )

    first = await service.report_outcome(
        command_id=commands.command.id,
        replica_id="runner-1",
        result="applied",
        execution_id="continuation-1",
        execution_state="started",
    )
    duplicate = await service.report_outcome(
        command_id=commands.command.id,
        replica_id="runner-2",
        result="applied",
        execution_id="continuation-1",
        execution_state="started",
    )

    assert first.admitted is True
    assert first.command.outcome == SessionCommandOutcome.started
    assert duplicate.admitted is False
    assert duplicate.command.id == first.command.id

    same_replica_retry = await service.report_outcome(
        command_id=commands.command.id,
        replica_id="runner-1",
        result="applied",
        execution_id="continuation-1",
        execution_state="started",
    )
    assert same_replica_retry.admitted is False

    executions.continuation = executions.continuation.model_copy(
        update={"state": SessionExecutionState.recoverable}
    )
    recovered = await service.report_outcome(
        command_id=commands.command.id,
        replica_id="runner-1",
        result="applied",
        execution_id="continuation-1",
        execution_state="started",
    )
    concurrent_retry = await service.report_outcome(
        command_id=commands.command.id,
        replica_id="runner-1",
        result="applied",
        execution_id="continuation-1",
        execution_state="started",
    )
    assert recovered.admitted is True
    assert concurrent_retry.admitted is False


@pytest.mark.asyncio
async def test_running_continuation_blocks_send_while_heartbeat_is_live():
    project_id = uuid4()
    interaction_id = uuid4()
    commands = _Commands()
    commands.command = _continuation_command(project_id, interaction_id).model_copy(
        update={
            "state": SessionCommandState.applied,
            "outcome": SessionCommandOutcome.started,
            "claimed_by": "runner-1",
        }
    )
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    executions.continuation = executions.continuation.model_copy(
        update={"state": SessionExecutionState.running}
    )
    delivery = _Unreachable()
    streams = SimpleNamespace(
        fetch_header=AsyncMock(
            return_value=SimpleNamespace(
                turn_id="continuation-1",
                updated_at=datetime.now(timezone.utc),
                flags=SimpleNamespace(is_alive=True),
            )
        )
    )
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=streams,
        interactions_service=_Interactions(
            SessionInteraction(
                id=interaction_id,
                project_id=project_id,
                session_id="session-1",
                turn_id="source-1",
                token="approval-1",
                kind=SessionInteractionKind.user_approval,
                status=SessionInteractionStatus.responded,
                data=SessionInteractionData(resolution={"approved": True}),
            )
        ),
        lock_engine=None,
        delivery=delivery,
        executions_dao=executions,
    )

    assert await service.resume_recoverable_continuation(
        project_id=project_id, session_id="session-1"
    )
    assert delivery.delivered == []
    assert commands.command.state == SessionCommandState.applied


@pytest.mark.asyncio
async def test_stale_heartbeat_never_replays_an_admitted_continuation():
    project_id = uuid4()
    interaction_id = uuid4()
    commands = _Commands()
    commands.command = _continuation_command(project_id, interaction_id).model_copy(
        update={
            "state": SessionCommandState.applied,
            "outcome": SessionCommandOutcome.started,
            "claimed_by": "runner-1",
        }
    )
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    executions.continuation = executions.continuation.model_copy(
        update={"state": SessionExecutionState.running}
    )
    delivery = _Unreachable()
    streams = SimpleNamespace(
        fetch_header=AsyncMock(
            return_value=SimpleNamespace(
                turn_id="continuation-1",
                updated_at=datetime.now(timezone.utc) - timedelta(minutes=5),
                flags=SimpleNamespace(is_alive=True),
            )
        )
    )
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=streams,
        interactions_service=_Interactions(
            SessionInteraction(
                id=interaction_id,
                project_id=project_id,
                session_id="session-1",
                turn_id="source-1",
                token="approval-1",
                kind=SessionInteractionKind.user_approval,
                status=SessionInteractionStatus.responded,
                data=SessionInteractionData(resolution={"approved": True}),
            )
        ),
        lock_engine=None,
        delivery=delivery,
        executions_dao=executions,
    )

    assert await service.resume_recoverable_continuation(
        project_id=project_id, session_id="session-1"
    )
    assert commands.command.state == SessionCommandState.applied
    assert commands.command.claimed_by == "runner-1"
    assert executions.continuation.state == SessionExecutionState.running
    assert delivery.delivered == []


@pytest.mark.asyncio
async def test_stop_winner_blocks_continuation_admission():
    project_id = uuid4()
    interaction_id = uuid4()
    commands = _Commands()
    commands.command = _continuation_command(project_id, interaction_id)
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    executions.continuation = executions.continuation.model_copy(
        update={"state": SessionExecutionState.stopping}
    )
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=None,
        interactions_service=_Interactions(
            SessionInteraction(
                id=interaction_id,
                project_id=project_id,
                session_id="session-1",
                turn_id="source-1",
                token="approval-1",
                kind=SessionInteractionKind.user_approval,
                status=SessionInteractionStatus.responded,
                data=SessionInteractionData(resolution={"approved": True}),
            )
        ),
        lock_engine=None,
        delivery=_Unreachable(),
        executions_dao=executions,
    )

    report = await service.report_outcome(
        command_id=commands.command.id,
        replica_id="runner-1",
        result="applied",
        execution_id="continuation-1",
        execution_state="started",
    )

    assert report.admitted is False
    assert commands.command.state == SessionCommandState.pending
    assert executions.continuation.state == SessionExecutionState.stopping


@pytest.mark.asyncio
async def test_watchdog_keeps_lost_continuation_recoverable():
    project_id = uuid4()
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    executions.continuation = executions.continuation.model_copy(
        update={"state": SessionExecutionState.running}
    )
    service = SessionCommandsService(
        commands_dao=_Commands(),
        streams_service=None,
        interactions_service=None,
        lock_engine=None,
        delivery=_Unreachable(),
        executions_dao=executions,
    )

    assert not await service.settle_execution_lost(
        project_id=project_id,
        session_id="session-1",
        execution_id="continuation-1",
        settled_at=datetime.now(timezone.utc),
    )
    assert executions.continuation.state == SessionExecutionState.recoverable
    assert executions.continuation.terminal_outcome is None


@pytest.mark.asyncio
async def test_persisted_completion_terminalizes_continuation_before_recovery():
    project_id = uuid4()
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    executions.continuation = executions.continuation.model_copy(
        update={"state": SessionExecutionState.running}
    )
    service = SessionCommandsService(
        commands_dao=_Commands(),
        streams_service=None,
        interactions_service=None,
        lock_engine=None,
        delivery=_Unreachable(),
        executions_dao=executions,
    )

    assert await service.settle_execution_completed(
        project_id=project_id,
        session_id="session-1",
        execution_id="continuation-1",
    )
    assert executions.continuation.state == SessionExecutionState.terminal
    assert executions.continuation.terminal_outcome == "completed"
    assert executions.continuation.settled_by == "runner"


@pytest.mark.asyncio
async def test_recovery_hooks_are_disabled_with_durable_stop(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", False)
    project_id = uuid4()
    interaction_id = uuid4()
    commands = _Commands()
    commands.command = _continuation_command(project_id, interaction_id)
    commands.abandoned = [commands.command]
    delivery = _Unreachable()
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=None,
        interactions_service=_Interactions(
            SessionInteraction(
                id=interaction_id,
                project_id=project_id,
                session_id="session-1",
                turn_id="source-1",
                token="approval-1",
                kind=SessionInteractionKind.user_approval,
                status=SessionInteractionStatus.responded,
                data=SessionInteractionData(resolution={"approved": True}),
            )
        ),
        lock_engine=None,
        delivery=delivery,
        executions_dao=_Executions(
            project_id=project_id, session_id="session-1", source_id="source-1"
        ),
    )

    assert (
        await service.resume_recoverable_continuation(
            project_id=project_id, session_id="session-1"
        )
        is False
    )
    assert await service.settle_abandoned_commands(now=datetime.now(timezone.utc)) == 0
    assert delivery.delivered == []
