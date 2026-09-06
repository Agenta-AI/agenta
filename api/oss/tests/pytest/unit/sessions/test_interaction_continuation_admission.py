from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from time import monotonic
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
from oss.src.core.sessions.inputs.dtos import PendingInput, PendingInputState


class _Commands:
    def __init__(self):
        self.command = None
        self.abandoned = []
        self.resumable = True

    @asynccontextmanager
    async def transaction(self):
        yield object()

    async def fetch_by_idempotency_key(self, **kwargs):
        if self.command and self.command.idempotency_key == kwargs["idempotency_key"]:
            return self.command
        return None

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
        if (
            self.resumable
            and self.command
            and (
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
def _durable_approvals_enabled(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", True)


class _Interactions:
    def __init__(self, interaction):
        self.interactions = [interaction]
        self.published = []

    @property
    def interaction(self):
        return self.interactions[0]

    @interaction.setter
    def interaction(self, value):
        self.interactions[0] = value

    async def fetch_interaction(self, *, interaction_id, **kwargs):
        return next(item for item in self.interactions if item.id == interaction_id)

    async def fetch_turn_interactions(self, **kwargs):
        return self.interactions

    async def transition_interaction(self, *, transition, **kwargs):
        index = next(
            index
            for index, item in enumerate(self.interactions)
            if item.token == transition.token
        )
        interaction = self.interactions[index]
        data = interaction.data or SessionInteractionData()
        self.interactions[index] = interaction.model_copy(
            update={
                "status": transition.status,
                "data": data.model_copy(update={"resolution": transition.resolution}),
            }
        )
        return self.interactions[index]

    async def publish_interaction_responded(self, **kwargs):
        self.published.append(kwargs)


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
        if current.terminal_outcome is not None:
            return SessionExecutionSettlementResult(settlement=current, won=False)
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


class _Inputs:
    def __init__(self, items):
        self.items = items

    async def promote_next(
        self, *, execution_id, input_id=None, only_policy=None, **kwargs
    ):
        item = next(
            (
                item
                for item in self.items
                if item.state == PendingInputState.pending
                and (input_id is None or item.id == input_id)
                and (only_policy is None or item.policy == only_policy)
            ),
            None,
        )
        if item is None:
            return None
        promoted = item.model_copy(
            update={
                "state": PendingInputState.promoted,
                "promoted_execution_id": execution_id,
            }
        )
        self.items[self.items.index(item)] = promoted
        return promoted


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
        "interaction_ids": [str(interaction_id)],
        "continuation_execution_id": admission.execution_id,
    }
    assert delivery.delivered[0].data["answer"] == {"approved": True}
    assert executions.source.terminal_outcome == "continued"
    assert executions.states[-1][1] == SessionExecutionState.recoverable
    assert interactions.published[0]["interactions"][0].data.resolution == {
        "approved": True
    }

    commands.command = commands.command.model_copy(
        update={"target_turn_id": "continuation-retry"}
    )
    retry = await service.respond_interaction(
        project_id=project_id,
        user_id=user_id,
        interaction_id=interaction_id,
        answer={"approved": True},
        expected_execution_id="source-1",
        idempotency_key="response-1",
    )
    assert retry.command.id == admission.command.id
    assert retry.execution_id == "continuation-retry"

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
async def test_parallel_answers_wait_then_share_one_continuation():
    project_id = uuid4()
    first_id = uuid4()
    second_id = uuid4()
    interactions = _Interactions(
        SessionInteraction(
            id=first_id,
            project_id=project_id,
            session_id="session-1",
            turn_id="source-1",
            token="approval-1",
            kind=SessionInteractionKind.user_approval,
            status=SessionInteractionStatus.pending,
        )
    )
    interactions.interactions.append(
        SessionInteraction(
            id=second_id,
            project_id=project_id,
            session_id="session-1",
            turn_id="source-1",
            token="approval-2",
            kind=SessionInteractionKind.user_approval,
            status=SessionInteractionStatus.pending,
        )
    )
    commands = _Commands()
    delivery = _Unreachable()
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=None,
        interactions_service=interactions,
        lock_engine=None,
        delivery=delivery,
        executions_dao=executions,
    )

    first = await service.respond_interaction(
        project_id=project_id,
        user_id=uuid4(),
        interaction_id=first_id,
        answer={"approved": True},
        expected_execution_id="source-1",
        idempotency_key="response-1",
    )

    assert first.command is None
    assert first.waiting_for_interactions is True
    assert interactions.interactions[0].status == SessionInteractionStatus.responded
    assert interactions.interactions[1].status == SessionInteractionStatus.pending
    assert executions.source.terminal_outcome is None
    assert delivery.delivered == []

    second = await service.respond_interaction(
        project_id=project_id,
        user_id=uuid4(),
        interaction_id=second_id,
        answer={"approved": False},
        expected_execution_id="source-1",
        idempotency_key="response-2",
    )

    assert second.command is not None
    assert executions.source.terminal_outcome == "continued"
    assert len(delivery.delivered) == 1
    assert delivery.delivered[0].data["answers"] == [
        {"interaction_id": str(first_id), "answer": {"approved": True}},
        {"interaction_id": str(second_id), "answer": {"approved": False}},
    ]

    retry = await service.respond_interaction(
        project_id=project_id,
        user_id=uuid4(),
        interaction_id=first_id,
        answer={"approved": True},
        expected_execution_id="source-1",
        idempotency_key="response-1-retry",
    )

    assert retry.interaction.id == first_id
    assert retry.command is None
    assert retry.execution_state == SessionExecutionState.terminal
    assert len(delivery.delivered) == 1


@pytest.mark.asyncio
async def test_approve_all_commits_one_continuation_for_the_batch():
    project_id = uuid4()
    first_id = uuid4()
    second_id = uuid4()
    interactions = _Interactions(
        SessionInteraction(
            id=first_id,
            project_id=project_id,
            session_id="session-1",
            turn_id="source-1",
            token="approval-1",
            kind=SessionInteractionKind.user_approval,
            status=SessionInteractionStatus.pending,
        )
    )
    interactions.interactions.append(
        SessionInteraction(
            id=second_id,
            project_id=project_id,
            session_id="session-1",
            turn_id="source-1",
            token="approval-2",
            kind=SessionInteractionKind.user_approval,
            status=SessionInteractionStatus.pending,
        )
    )
    commands = _Commands()
    delivery = _Unreachable()
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=None,
        interactions_service=interactions,
        lock_engine=None,
        delivery=delivery,
        executions_dao=executions,
    )

    admission = await service.respond_interactions(
        project_id=project_id,
        user_id=uuid4(),
        interaction_answers=[
            (first_id, {"approved": True}),
            (second_id, {"approved": True}),
        ],
        expected_execution_id="source-1",
        idempotency_key="approve-all",
    )

    assert admission.command is not None
    assert len(delivery.delivered) == 1
    assert {
        item["interaction_id"] for item in delivery.delivered[0].data["answers"]
    } == {
        str(first_id),
        str(second_id),
    }


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

    assert resumed == commands.command.target_turn_id
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
    assert resumed == commands.command.target_turn_id
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
async def test_parked_running_continuation_does_not_own_send_preflight():
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
    commands.resumable = False
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

    assert not await service.resume_recoverable_continuation(
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
async def test_watchdog_does_not_recover_continuation_when_approvals_are_disabled(
    monkeypatch,
):
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", False)
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

    assert await service.settle_execution_lost(
        project_id=project_id,
        session_id="session-1",
        execution_id="continuation-1",
        settled_at=datetime.now(timezone.utc),
    )
    assert executions.continuation.state == SessionExecutionState.terminal
    assert executions.continuation.terminal_outcome == SessionCommandOutcome.lost.value


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
async def test_completion_promotes_exactly_one_pending_input_once(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    project_id = uuid4()
    user_id = uuid4()
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    items = _Inputs(
        [
            PendingInput(
                id=uuid4(),
                project_id=project_id,
                session_id="session-1",
                content={"session_id": "session-1", "data": {"messages": ["one"]}},
                position=1,
                state=PendingInputState.pending,
                policy="queue",
                idempotency_key="queue-1",
                request_fingerprint="a" * 64,
                created_by_id=user_id,
            ),
            PendingInput(
                id=uuid4(),
                project_id=project_id,
                session_id="session-1",
                content={"session_id": "session-1", "data": {"messages": ["two"]}},
                position=2,
                state=PendingInputState.pending,
                policy="queue",
                idempotency_key="queue-2",
                request_fingerprint="b" * 64,
                created_by_id=user_id,
            ),
        ]
    )
    commands = _Commands()
    delivery = _Unreachable()
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=None,
        interactions_service=None,
        lock_engine=None,
        delivery=delivery,
        executions_dao=executions,
        inputs_dao=items,
    )
    service._reconcile_stopped_redis = AsyncMock()

    assert await service.settle_execution_completed(
        project_id=project_id,
        session_id="session-1",
        execution_id="source-1",
    )
    assert items.items[0].state == PendingInputState.promoted
    assert items.items[1].state == PendingInputState.pending
    assert commands.command.kind == SessionCommandKind.continue_input
    assert commands.command.data["request"]["meta"]["promoted_input_id"] == str(
        items.items[0].id
    )
    assert len(delivery.delivered) == 1

    assert await service.settle_execution_completed(
        project_id=project_id,
        session_id="session-1",
        execution_id="source-1",
    )
    assert items.items[1].state == PendingInputState.pending
    assert len(delivery.delivered) == 1


@pytest.mark.asyncio
async def test_done_record_admits_promoted_input_within_one_second(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    project_id = uuid4()
    source_reconciled = False
    admitted_at = None

    class _ReleaseAwareDelivery:
        async def deliver(self, **kwargs):
            nonlocal admitted_at
            if not source_reconciled:
                return DeliveryReceipt(
                    status="unreachable", detail="source execution still owns running"
                )
            admitted_at = monotonic()
            return DeliveryReceipt(status="accepted", replica_id="runner-1")

        async def acknowledge(self, **kwargs):
            return None

    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    items = _Inputs([_pending_input(project_id, policy="queue", position=1)])
    service = SessionCommandsService(
        commands_dao=_Commands(),
        streams_service=None,
        interactions_service=None,
        lock_engine=None,
        delivery=_ReleaseAwareDelivery(),
        executions_dao=executions,
        inputs_dao=items,
    )

    async def reconcile_source(**kwargs):
        nonlocal source_reconciled
        source_reconciled = True

    service._reconcile_stopped_redis = AsyncMock(side_effect=reconcile_source)
    done_record_at = monotonic()

    assert await service.settle_execution_completed(
        project_id=project_id,
        session_id="session-1",
        execution_id="source-1",
    )

    assert items.items[0].state == PendingInputState.promoted
    service._reconcile_stopped_redis.assert_awaited_once_with(
        project_id=project_id,
        session_id="session-1",
        execution_id="source-1",
    )
    assert admitted_at is not None
    assert admitted_at - done_record_at < 1


@pytest.mark.asyncio
async def test_completion_handles_a_lost_input_delivery_reservation(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    project_id = uuid4()
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    items = _Inputs([_pending_input(project_id, policy="queue", position=1)])
    commands = _Commands()
    commands.record_delivery_attempt = AsyncMock(return_value=None)
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=None,
        interactions_service=None,
        lock_engine=None,
        delivery=_Unreachable(),
        executions_dao=executions,
        inputs_dao=items,
    )
    service._reconcile_stopped_redis = AsyncMock()

    assert await service.settle_execution_completed(
        project_id=project_id,
        session_id="session-1",
        execution_id="source-1",
    )
    assert items.items[0].state == PendingInputState.promoted
    assert executions.continuation.state == SessionExecutionState.recoverable


@pytest.mark.asyncio
async def test_recovery_hooks_are_disabled_with_durable_approvals(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "durable_approvals", False)
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
        is None
    )
    assert await service.settle_abandoned_commands(now=datetime.now(timezone.utc)) == 0
    assert delivery.delivered == []


class _StartedThenUnreachable:
    """The runner admits the continuation and reports `started`, then the transport fails.

    The real shape of it (browser pass, 2026-09-04 17:28Z-17:35Z): the runner posted its
    outcome, the API turned the execution `running`, and only afterwards did the detached-start
    parser reject the stream. Both executions ran to completion carrying
    `error.code = continuation_delivery_failed`, so the card offered a retry for work that was
    already done.
    """

    def __init__(self, executions, execution_id):
        self._executions = executions
        self._execution_id = execution_id
        self.delivered = []

    async def deliver(self, **kwargs):
        command = kwargs["command"]
        self.delivered.append(command)
        await self._executions.set_state(
            project_id=command.project_id,
            session_id=command.session_id,
            execution_id=self._execution_id,
            state=SessionExecutionState.running,
            error=None,
        )
        return DeliveryReceipt(
            status="unreachable", detail="parser rejected the stream"
        )

    async def acknowledge(self, **kwargs):
        return None


@pytest.mark.asyncio
async def test_a_late_delivery_failure_does_not_demote_a_running_continuation():
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
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    delivery = _StartedThenUnreachable(executions, "continuation-1")
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=None,
        interactions_service=_Interactions(interaction),
        lock_engine=None,
        delivery=delivery,
        executions_dao=executions,
    )

    resumed = await service.resume_recoverable_continuation(
        project_id=project_id, session_id="session-1"
    )

    assert resumed == "continuation-1"
    assert delivery.delivered
    # The turn the runner is already running keeps `running`. The recoverable projection is
    # refused, so the card never asks the user to retry work that is under way.
    assert executions.continuation.state == SessionExecutionState.running
    assert executions.continuation.error is None


@pytest.mark.asyncio
async def test_a_send_after_the_budget_is_spent_reopens_the_continuation(monkeypatch):
    """Command 01a06d7a of the same pass: three refusals, then a command nothing redelivers.

    The budget bounds the automatic loop only. A Send arriving before the sweep settles the
    command must not be swallowed: settle it exhausted, retarget a fresh execution, deliver.
    """
    maximum = 3
    monkeypatch.setattr(env.agenta.sessions.commands, "max_deliveries", maximum)
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
    commands.command = _continuation_command(
        project_id, interaction_id, claim_count=maximum
    )
    spent = commands.command
    executions = _Executions(
        project_id=project_id, session_id="session-1", source_id="source-1"
    )
    delivery = _Unreachable()
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=None,
        interactions_service=_Interactions(interaction),
        lock_engine=None,
        delivery=delivery,
        executions_dao=executions,
    )

    resumed = await service.resume_recoverable_continuation(
        project_id=project_id, session_id="session-1"
    )

    assert resumed == commands.command.target_turn_id
    # The exhausted attempt is recorded as ended and the command now targets a NEW execution:
    # redelivering the old id is what spent the budget in the first place.
    assert commands.command.target_turn_id != spent.target_turn_id
    assert commands.command.claim_count == 0
    assert delivery.delivered
    assert delivery.delivered[0].target_turn_id == commands.command.target_turn_id


def _pending_input(project_id, *, policy, position):
    return PendingInput(
        id=uuid4(),
        project_id=project_id,
        session_id="session-1",
        content={"session_id": "session-1", "data": {"messages": [policy]}},
        position=position,
        state=PendingInputState.pending,
        policy=policy,
        idempotency_key=f"{policy}-{position}",
        request_fingerprint=str(position) * 64,
        created_by_id=uuid4(),
    )


def _stop_service(*, project_id, command_data, inputs):
    commands = _Commands()
    commands.command = SessionCommand(
        id=uuid4(),
        project_id=project_id,
        session_id="session-1",
        kind=SessionCommandKind.cancel,
        target_turn_id="source-1",
        data=command_data,
        state=SessionCommandState.pending,
        created_at=datetime.now(timezone.utc),
    )
    streams = SimpleNamespace(
        settle_command=AsyncMock(),
        publish_session_ended=AsyncMock(),
    )
    interactions = SimpleNamespace(
        cancel_session_pending=AsyncMock(return_value=0),
        publish_session_pending_cancelled=AsyncMock(),
    )
    service = SessionCommandsService(
        commands_dao=commands,
        streams_service=streams,
        interactions_service=interactions,
        lock_engine=None,
        delivery=_Unreachable(),
        executions_dao=_Executions(
            project_id=project_id,
            session_id="session-1",
            source_id="source-1",
        ),
        inputs_dao=inputs,
    )
    service._reconcile_stopped_redis = AsyncMock()
    return service, commands


@pytest.mark.asyncio
async def test_manual_stop_pauses_pending_steer(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    project_id = uuid4()
    steered = _pending_input(project_id, policy="steer", position=0)
    inputs = _Inputs([steered])
    service, commands = _stop_service(
        project_id=project_id,
        command_data=None,
        inputs=inputs,
    )

    settled = await service.settle(
        command_id=commands.command.id,
        project_id=project_id,
        replica_id=None,
        expected_states=[SessionCommandState.pending],
        state=SessionCommandState.applied,
        outcome=SessionCommandOutcome.stopped,
        execution_id="source-1",
    )

    assert settled is not None
    assert inputs.items[0].state == PendingInputState.pending


@pytest.mark.asyncio
async def test_steer_stop_promotes_its_saved_input_before_queue(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    project_id = uuid4()
    queued = _pending_input(project_id, policy="queue", position=1)
    steered = _pending_input(project_id, policy="steer", position=0)
    inputs = _Inputs([queued, steered])
    service, commands = _stop_service(
        project_id=project_id,
        command_data={"steer_input_id": str(steered.id)},
        inputs=inputs,
    )

    settled = await service.settle(
        command_id=commands.command.id,
        project_id=project_id,
        replica_id=None,
        expected_states=[SessionCommandState.pending],
        state=SessionCommandState.applied,
        outcome=SessionCommandOutcome.stopped,
        execution_id="source-1",
    )

    assert settled is not None
    assert inputs.items[0].state == PendingInputState.pending
    assert inputs.items[1].state == PendingInputState.promoted
    assert commands.command.kind == SessionCommandKind.continue_input
    assert commands.command.data["input_id"] == str(steered.id)


@pytest.mark.asyncio
async def test_steer_handles_a_lost_input_delivery_reservation(monkeypatch):
    monkeypatch.setattr(env.agenta.sessions, "queue", True)
    monkeypatch.setattr(env.agenta.sessions, "steer", True)
    project_id = uuid4()
    steered = _pending_input(project_id, policy="steer", position=0)
    inputs = _Inputs([steered])
    service, commands = _stop_service(
        project_id=project_id,
        command_data={"steer_input_id": str(steered.id)},
        inputs=inputs,
    )
    commands.record_delivery_attempt = AsyncMock(return_value=None)

    settled = await service.settle(
        command_id=commands.command.id,
        project_id=project_id,
        replica_id=None,
        expected_states=[SessionCommandState.pending],
        state=SessionCommandState.applied,
        outcome=SessionCommandOutcome.stopped,
        execution_id="source-1",
    )

    assert settled is not None
    assert inputs.items[0].state == PendingInputState.promoted
    assert service._executions.continuation.state == SessionExecutionState.recoverable
