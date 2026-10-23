"""Refused continuations are terminal settlements, persisted (M2, plan decision 7).

A queued input whose run envelope is missing, or whose principal lost access, is
settled in one transaction: the command `obsolete`/`failed`, the execution stores
the AgentError and is settled `failed`. The receipt is `refused` (never a transport
retry), and the refused input stops being the active successor.
"""

import uuid
from datetime import datetime, timezone

import pytest

from oss.src.core.access.dtos import Decision, DecisionReason
from oss.src.core.access.types import AccessDenied, MissingEnvelope
from oss.src.core.sessions.commands.dtos import (
    SessionCommandCreate,
    SessionCommandKind,
    SessionCommandOutcome,
    SessionCommandState,
)
from oss.src.core.sessions.commands.service import SessionCommandsService
from oss.src.core.sessions.executions.dtos import SessionExecutionState
from oss.src.core.sessions.inputs.dtos import PendingInputCreate
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.dbs.http.sessions.control_delivery_direct import DirectControlDelivery
from oss.src.dbs.postgres.sessions.commands.dao import SessionCommandsDAO
from oss.src.dbs.postgres.sessions.executions.dao import SessionExecutionsDAO
from oss.src.dbs.postgres.sessions.inputs.dao import SessionInputsDAO
from oss.src.dbs.postgres.sessions.interactions.dao import SessionInteractionsDAO
import oss.src.dbs.postgres.shared.engine as engine_module
from oss.tests.pytest.utils.principals import make_envelope
from unit.sessions.test_session_commands_dao import command_scope  # noqa: F401

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


async def _queued_input(scope, *, envelope, message="later", key="k1"):
    """A promoted input with its continuation execution and continue_input command,
    as `_promote_next_input` leaves them."""

    engine = scope["engine"]
    inputs = SessionInputsDAO(engine=engine)
    executions = SessionExecutionsDAO(engine=engine)
    commands = SessionCommandsDAO(engine=engine)
    execution_id = str(uuid.uuid4())
    item = await inputs.create_input(
        user_id=scope["user_id"],
        pending_input=PendingInputCreate(
            project_id=scope["project_id"],
            session_id=scope["session_id"],
            content={"message": message},
            policy="queue",
            idempotency_key=key,
            request_fingerprint=key.ljust(64, "0"),
            run_envelope=envelope,
        ),
    )
    async with commands.transaction() as transaction:
        await executions.create_continuation(
            project_id=scope["project_id"],
            session_id=scope["session_id"],
            execution_id=execution_id,
            parent_execution_id="turn-A",
            source_interaction_id=None,
            transaction=transaction,
        )
        promoted = await inputs.promote_next(
            project_id=scope["project_id"],
            session_id=scope["session_id"],
            execution_id=execution_id,
            input_id=item.id,
            transaction=transaction,
        )
        command = await commands.create_command(
            user_id=scope["user_id"],
            command=SessionCommandCreate(
                project_id=scope["project_id"],
                session_id=scope["session_id"],
                kind=SessionCommandKind.continue_input,
                target_turn_id=execution_id,
                expected_turn_id="turn-A",
                data={
                    "input_id": str(item.id),
                    "continuation_execution_id": execution_id,
                    "request": {"data": {"inputs": {"message": message}}},
                },
                idempotency_key=f"input:{item.id}",
                created_at=datetime.now(timezone.utc),
                run_envelope=promoted.run_envelope,
            ),
            transaction=transaction,
        )
        await transaction.commit()
    return command, execution_id, inputs, executions, commands


def _service(scope, *, continue_input):
    engine = scope["engine"]
    return SessionCommandsService(
        commands_dao=SessionCommandsDAO(engine=engine),
        streams_service=None,
        interactions_service=SessionInteractionsService(
            interactions_dao=SessionInteractionsDAO(engine=engine)
        ),
        lock_engine=None,
        delivery=DirectControlDelivery(continue_input=continue_input),
        executions_dao=SessionExecutionsDAO(engine=engine),
        inputs_dao=SessionInputsDAO(engine=engine),
    )


async def _deny(command):
    raise AccessDenied(
        decision=Decision(allowed=False, reason=DecisionReason.NOT_MEMBER)
    )


async def _missing(command):
    raise MissingEnvelope()


async def test_principal_lost_access_while_queued(command_scope):  # noqa: F811
    envelope = make_envelope(kind="api_key", origin="api", origin_id="k", sender=None)
    command, execution_id, _, executions, commands = await _queued_input(
        command_scope, envelope=envelope
    )
    # The stored envelope rode from the input onto the command.
    assert command.run_envelope == envelope

    receipt = await _service(command_scope, continue_input=_deny)._deliver(command)

    assert receipt.status == "refused" and receipt.detail == "access_denied"
    stored = await commands.fetch_command(
        command_id=command.id, project_id=command_scope["project_id"]
    )
    assert stored.state == SessionCommandState.obsolete
    assert stored.outcome == SessionCommandOutcome.failed
    execution = await executions.fetch_execution(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
        execution_id=execution_id,
    )
    assert execution.state == SessionExecutionState.terminal
    assert execution.terminal_outcome == "failed"
    assert execution.error["code"] == "access_denied"
    assert execution.error["retryable"] is False
    assert execution.error["details"]["principal_kind"] == "api_key"


async def test_command_without_envelope_is_cancelled(command_scope):  # noqa: F811
    command, execution_id, _, executions, _ = await _queued_input(
        command_scope, envelope=None
    )
    assert command.run_envelope is None

    receipt = await _service(command_scope, continue_input=_missing)._deliver(command)

    assert receipt.status == "refused"
    execution = await executions.fetch_execution(
        project_id=command_scope["project_id"],
        session_id=command_scope["session_id"],
        execution_id=execution_id,
    )
    assert execution.error["code"] == "missing_envelope"
    assert execution.error["next_step"] == "Send the message again."


async def test_refusal_is_not_a_transport_retry(command_scope):  # noqa: F811
    command, _, _, _, commands = await _queued_input(
        command_scope, envelope=make_envelope()
    )
    service = _service(command_scope, continue_input=_deny)
    receipt = await service._deliver(command)
    assert receipt.status not in ("unreachable", "accepted")

    stored = await commands.fetch_command(
        command_id=command.id, project_id=command_scope["project_id"]
    )
    claim_count = stored.claim_count
    # A later delivery attempt (the sweep) finds a settled command and does nothing.
    again = await service._deliver(stored)
    assert again is None or again.status != "accepted"
    after = await commands.fetch_command(
        command_id=command.id, project_id=command_scope["project_id"]
    )
    assert after.claim_count == claim_count
    assert after.state == SessionCommandState.obsolete


async def test_refused_input_is_not_an_active_successor_and_the_next_input_proceeds(
    command_scope,  # noqa: F811
):
    command, _, inputs, _, commands = await _queued_input(
        command_scope, envelope=make_envelope()
    )
    async with commands.transaction() as transaction:
        before = await inputs.fetch_active_successor(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
            transaction=transaction,
        )
    assert before is not None

    await _service(command_scope, continue_input=_deny)._deliver(command)

    async with commands.transaction() as transaction:
        after = await inputs.fetch_active_successor(
            project_id=command_scope["project_id"],
            session_id=command_scope["session_id"],
            transaction=transaction,
        )
    assert after is None

    # The next input queues and is promoted as the session's next execution.
    second, _, _, _, _ = await _queued_input(
        command_scope, envelope=make_envelope(), message="next", key="k2"
    )
    assert second.kind == SessionCommandKind.continue_input
    assert second.state == SessionCommandState.pending


async def _interaction(scope, *, envelope, token):
    import json

    from sqlalchemy import text

    from oss.src.core.access.principals import envelope_to_json

    interaction_id = uuid.uuid4()
    async with scope["engine"].session() as session:
        await session.execute(
            text(
                "INSERT INTO session_interactions "
                "(project_id, id, session_id, turn_id, token, kind, status, "
                "run_envelope) VALUES (:p, :id, :s, 'turn-A', :token, "
                "'user_approval', 'pending', CAST(:e AS jsonb))"
            ),
            {
                "p": scope["project_id"],
                "id": interaction_id,
                "s": scope["session_id"],
                "token": token,
                "e": (
                    json.dumps(envelope_to_json(envelope=envelope))
                    if envelope is not None
                    else None
                ),
            },
        )
        await session.execute(
            text(
                "INSERT INTO session_executions (project_id, session_id, "
                "execution_id, state) VALUES (:p, :s, 'turn-A', 'active') "
                "ON CONFLICT DO NOTHING"
            ),
            {"p": scope["project_id"], "s": scope["session_id"]},
        )
        await session.commit()
    return interaction_id


class _Unreachable:
    async def deliver(self, **kwargs):
        from oss.src.core.sessions.commands.interfaces import DeliveryReceipt

        return DeliveryReceipt(status="unreachable")

    async def acknowledge(self, **kwargs):
        return None


def _respond_service(scope):
    engine = scope["engine"]
    return SessionCommandsService(
        commands_dao=SessionCommandsDAO(engine=engine),
        streams_service=None,
        interactions_service=SessionInteractionsService(
            interactions_dao=SessionInteractionsDAO(engine=engine)
        ),
        lock_engine=None,
        delivery=_Unreachable(),
        executions_dao=SessionExecutionsDAO(engine=engine),
    )


async def test_approval_without_envelope_is_409_and_cancelled(command_scope):  # noqa: F811
    from oss.src.core.sessions.interactions.dtos import SessionInteractionStatus
    from oss.tests.pytest.utils.principals import any_approval

    interaction_id = await _interaction(command_scope, envelope=None, token="pre-m2")
    with pytest.raises(MissingEnvelope):
        await _respond_service(command_scope).respond_interaction(
            project_id=command_scope["project_id"],
            user_id=command_scope["user_id"],
            interaction_id=interaction_id,
            answer={"approved": True},
            expected_execution_id=None,
            idempotency_key="answer-pre-m2",
            approved_by=any_approval(),
        )
    # The cancellation was committed before the refusal.
    stored = await SessionInteractionsDAO(
        engine=command_scope["engine"]
    ).fetch_interaction(
        project_id=command_scope["project_id"], interaction_id=interaction_id
    )
    assert stored.status == SessionInteractionStatus.cancelled


async def test_api_key_run_approved_by_human_records_approver_kind(command_scope):  # noqa: F811
    from oss.src.core.access.dtos import PrincipalKind, PrincipalRef, RunApproval

    asked = make_envelope(
        kind="api_key", origin="api", origin_id="key-1", sender=None, run_id="turn-A"
    )
    interaction_id = await _interaction(command_scope, envelope=asked, token="m2")
    bob = uuid.uuid4()
    approval = RunApproval(principal=PrincipalRef(kind="human", id=bob), user_id=bob)
    admission = await _respond_service(command_scope).respond_interaction(
        project_id=command_scope["project_id"],
        user_id=command_scope["user_id"],
        interaction_id=interaction_id,
        answer={"approved": True},
        expected_execution_id=None,
        idempotency_key="answer-m2",
        approved_by=approval,
    )
    stored = await SessionCommandsDAO(engine=command_scope["engine"]).fetch_command(
        command_id=admission.command.id, project_id=command_scope["project_id"]
    )
    resumed = stored.run_envelope
    assert resumed.authority == asked.authority
    assert resumed.authority.principal.kind == PrincipalKind.API_KEY
    assert resumed.sender is None
    assert resumed.approved_by == approval
    assert resumed.context.run_id == admission.execution_id
