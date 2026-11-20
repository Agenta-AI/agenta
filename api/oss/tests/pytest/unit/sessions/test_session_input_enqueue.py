"""`enqueue_session_input`, `is_sent_by_person` and the reserved `ag:` keys."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from oss.src.core.access.dtos import RunContext, RunOrigin
from oss.src.core.sessions.executions.dtos import (
    SessionExecutionSettlement,
    SessionExecutionState,
)
from oss.src.core.sessions.executions.senders import is_sent_by_person
from oss.src.core.sessions.inputs.dtos import (
    PendingInputCreate,
    PendingInputKind,
    PendingInputState,
)
from oss.src.core.sessions.inputs.service import SessionInputsService
from oss.src.core.sessions.inputs.types import (
    SessionInputEnvelopeMismatch,
    SessionInputIdempotencyConflict,
    SessionInputKeyReserved,
)
from oss.src.core.sessions.interactions.dtos import SessionInteractionStatus
from oss.src.core.sessions.starts.service import SessionStartsService
from oss.src.core.sharing.admission import CHILD_RUN_BOUNDARY
from oss.src.dbs.postgres.sessions.inputs.mappings import (
    new_input_row,
    to_pending_input,
)
from oss.tests.pytest.unit.sessions.test_pending_inputs_service import (
    MemoryInputsDAO,
)
from oss.tests.pytest.utils.principals import make_envelope
from oss.tests.pytest.utils.sharing import RecordingRunAdmission


PROJECT_ID = uuid4()
USER_ID = uuid4()
SESSION_ID = "chief-of-staff"
ENVELOPE = make_envelope(project_id=PROJECT_ID, principal_id=USER_ID)


class _MemoryLock:
    def __init__(self):
        self.values = {}

    async def set(self, key, value, *, nx, ex):
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    async def eval(self, script, number_of_keys, key, token):
        if self.values.get(key) == token:
            del self.values[key]
        return 1


class _InputsDAO(MemoryInputsDAO):
    def __init__(self):
        super().__init__()
        self.dispatched = set()

    async def claim_dispatch(self, *, project_id, session_id, input_id, execution_id):
        item = await self.fetch_input(
            project_id=project_id, session_id=session_id, input_id=input_id
        )
        if item is None or input_id in self.dispatched:
            return False
        self.dispatched.add(input_id)
        return True

    async def fetch_by_execution_id(self, *, project_id, session_id, execution_id):
        return next(
            (
                item
                for item in self.items
                if item.project_id == project_id
                and item.session_id == session_id
                and item.promoted_execution_id == execution_id
            ),
            None,
        )


class _Streams:
    """The streams service for admission: running, or waiting on an approval."""

    def __init__(self, *, running=False, turn_id=None):
        self.running = running
        self.turn_id = turn_id

    async def fetch_header(self, **_kwargs):
        return SimpleNamespace(
            flags=SimpleNamespace(is_running=self.running), turn_id=self.turn_id
        )


class _StreamsDAO:
    def __init__(self, *, deleted=False):
        self.deleted = deleted

    async def get_by_session_id(self, **_kwargs):
        return None

    async def get_by_session_id_including_archived(self, **_kwargs):
        return SimpleNamespace(deleted_at="2026-11-20" if self.deleted else None)


class _Executions:
    def __init__(self):
        self.rows = {}

    def add(self, execution_id, *, parent=None, outcome=None, session_id=SESSION_ID):
        self.rows[(session_id, execution_id)] = SessionExecutionSettlement(
            project_id=PROJECT_ID,
            session_id=session_id,
            execution_id=execution_id,
            state=SessionExecutionState.terminal
            if outcome
            else SessionExecutionState.running,
            parent_execution_id=parent,
            terminal_outcome=outcome,
        )

    async def fetch_execution(self, *, project_id, session_id, execution_id, **_):
        if project_id != PROJECT_ID:
            return None
        return self.rows.get((session_id, execution_id))


class _Turns:
    """Turn rows, newest first, as `query_turns` answers with a descending window."""

    def __init__(self):
        self.rows = []

    def add(self, turn_id, origin, *, session_id=SESSION_ID, project_id=PROJECT_ID):
        self.rows.insert(
            0,
            SimpleNamespace(
                project_id=project_id,
                session_id=session_id,
                turn_id=UUID(turn_id),
                context=RunContext(origin=origin) if origin is not None else None,
            ),
        )

    async def query_turns(self, *, project_id, query, windowing):
        rows = [
            row
            for row in self.rows
            if row.project_id == project_id and row.session_id == query.session_id
        ]
        return rows[: windowing.limit]

    async def find_turn(self, *, project_id, session_id, turn_id):
        return next(
            (
                row
                for row in self.rows
                if row.project_id == project_id
                and row.session_id == session_id
                and row.turn_id == turn_id
            ),
            None,
        )


class _Interactions:
    async def fetch_turn_interactions(self, **_kwargs):
        return [SimpleNamespace(status=SessionInteractionStatus.pending)]


class _Harness:
    def __init__(
        self, *, running=False, waits_for_approval=False, deleted=False, steer=False
    ):
        self.inputs_dao = _InputsDAO()
        self.executions = _Executions()
        self.turns = _Turns()
        self.admission = RecordingRunAdmission()
        self.workflows = AsyncMock()

        async def invoke(**kwargs):
            self.executions.add(kwargs["run_id"])

        self.workflows.invoke_workflow_detached.side_effect = invoke
        self.inputs = SessionInputsService(
            inputs_dao=self.inputs_dao,
            streams_service=_Streams(
                running=running,
                turn_id="execution-parked" if waits_for_approval else None,
            ),
            interactions_dao=_Interactions() if waits_for_approval else None,
        )
        self.service = SessionStartsService(
            inputs_service=self.inputs,
            executions_dao=self.executions,
            streams_dao=_StreamsDAO(deleted=deleted),
            inputs_dao=self.inputs_dao,
            turns_dao=self.turns,
            cancelled_by_steer=AsyncMock(return_value=steer),
            workflows_service=self.workflows,
            lock_engine=_MemoryLock(),
            run_admission=self.admission,
            poll_timeout_seconds=0,
        )

    async def enqueue(self, *, key="ag:child_update:child-1:x1", **overrides):
        args = {
            "project_id": PROJECT_ID,
            "user_id": USER_ID,
            "session_id": SESSION_ID,
            "kind": PendingInputKind.child_update,
            "content": _content(),
            "idempotency_key": key,
            "run_envelope": ENVELOPE,
            "dispatch_boundary": CHILD_RUN_BOUNDARY,
        }
        args.update(overrides)
        return await self.service.enqueue_session_input(**args)


WORKFLOW_ID = str(uuid4())


def _content(text="The child session ended.", session_id=SESSION_ID):
    return {
        "session_id": session_id,
        "references": {"workflow": {"id": WORKFLOW_ID}},
        "data": {"inputs": {"messages": [{"role": "user", "content": text}]}},
    }


def _ids(count):
    return [str(uuid4()) for _ in range(count)]


# --- enqueue_session_input ---------------------------------------------------------


@pytest.mark.asyncio
async def test_an_idle_session_claims_and_dispatches_the_input():
    harness = _Harness()

    result = await harness.enqueue()

    assert result.state == PendingInputState.promoted
    [item] = harness.inputs_dao.items
    assert item.kind == PendingInputKind.child_update
    assert item.idempotency_key == "ag:child_update:child-1:x1"
    assert item.promoted_execution_id == result.execution_id
    invoke = harness.workflows.invoke_workflow_detached.await_args.kwargs
    assert invoke["run_id"] == result.execution_id
    assert invoke["envelope"] == ENVELOPE
    [(method, admitted)] = harness.admission.calls
    assert method == "admit_request"
    assert admitted["boundary"] == CHILD_RUN_BOUNDARY
    assert admitted["session_id"] == SESSION_ID


@pytest.mark.asyncio
async def test_a_busy_session_queues_the_input():
    harness = _Harness(running=True)

    result = await harness.enqueue()

    assert result.state == PendingInputState.pending
    assert harness.inputs_dao.items[0].policy == "queue"
    harness.workflows.invoke_workflow_detached.assert_not_awaited()
    assert harness.admission.calls == []


@pytest.mark.asyncio
async def test_a_session_waiting_for_an_approval_queues_the_input_behind_it():
    harness = _Harness(waits_for_approval=True)

    result = await harness.enqueue()

    assert result.state == PendingInputState.pending
    harness.workflows.invoke_workflow_detached.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_repeated_key_writes_one_row_and_runs_one_turn():
    harness = _Harness()

    first = await harness.enqueue()
    second = await harness.enqueue()

    assert len(harness.inputs_dao.items) == 1
    assert second.input_id == first.input_id
    assert second.execution_id == first.execution_id
    assert harness.workflows.invoke_workflow_detached.await_count == 1


@pytest.mark.asyncio
async def test_a_repeated_key_with_other_content_is_a_conflict():
    harness = _Harness(running=True)
    await harness.enqueue()

    with pytest.raises(SessionInputIdempotencyConflict):
        await harness.enqueue(content=_content("Another text."))


@pytest.mark.asyncio
async def test_a_stopped_session_does_not_wake():
    harness = _Harness()
    [person] = _ids(1)
    harness.turns.add(person, RunOrigin.WEB)
    harness.executions.add(person, outcome="stopped")

    result = await harness.enqueue()

    assert result.state == PendingInputState.pending
    harness.workflows.invoke_workflow_detached.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_steer_is_not_a_person_stopping_the_session():
    harness = _Harness(steer=True)
    [person] = _ids(1)
    harness.turns.add(person, RunOrigin.WEB)
    harness.executions.add(person, outcome="stopped")

    result = await harness.enqueue()

    assert result.state == PendingInputState.promoted


@pytest.mark.asyncio
async def test_an_ended_session_does_not_wake():
    harness = _Harness(deleted=True)

    result = await harness.enqueue()

    assert result.state == PendingInputState.pending
    harness.workflows.invoke_workflow_detached.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_relayed_message_is_not_held_by_a_stop():
    """The rule is for server inputs; a relayed message has `kind = message`."""
    harness = _Harness()
    [person] = _ids(1)
    harness.turns.add(person, RunOrigin.WEB)
    harness.executions.add(person, outcome="stopped")

    result = await harness.enqueue(
        key="ag:send:calling:execution:call-1", kind=PendingInputKind.message
    )

    assert result.state == PendingInputState.promoted


@pytest.mark.asyncio
async def test_twenty_turns_with_no_person_hold_the_next_server_input():
    harness = _Harness()
    for execution_id in _ids(20):
        harness.turns.add(execution_id, RunOrigin.WEB)
        harness.inputs_dao.items.append(
            to_pending_input(
                _row(
                    kind=PendingInputKind.child_update,
                    promoted_execution_id=execution_id,
                )
            )
        )

    result = await harness.enqueue()

    assert result.state == PendingInputState.pending
    harness.workflows.invoke_workflow_detached.assert_not_awaited()


@pytest.mark.asyncio
async def test_one_person_turn_in_the_window_lets_the_server_input_run():
    harness = _Harness()
    ids = _ids(20)
    harness.turns.add(ids[0], RunOrigin.WEB)  # the oldest of the window: a person
    for execution_id in ids[1:]:
        harness.turns.add(execution_id, RunOrigin.SCHEDULE)

    result = await harness.enqueue()

    assert result.state == PendingInputState.promoted


@pytest.mark.asyncio
async def test_fewer_turns_than_the_cap_never_hold():
    harness = _Harness()
    for execution_id in _ids(19):
        harness.turns.add(execution_id, RunOrigin.SCHEDULE)

    result = await harness.enqueue()

    assert result.state == PendingInputState.promoted


@pytest.mark.asyncio
async def test_an_envelope_of_another_project_is_refused():
    harness = _Harness()

    with pytest.raises(SessionInputEnvelopeMismatch):
        await harness.enqueue(run_envelope=make_envelope(project_id=uuid4()))

    assert harness.inputs_dao.items == []


@pytest.mark.asyncio
async def test_the_same_session_id_in_two_projects_gets_one_row():
    harness = _Harness()
    other_project = uuid4()
    harness.inputs_dao.items.append(
        to_pending_input(
            _row(
                project_id=other_project,
                idempotency_key="ag:child_update:child-1:x1",
            )
        )
    )

    result = await harness.enqueue()

    mine = [item for item in harness.inputs_dao.items if item.project_id == PROJECT_ID]
    assert [item.id for item in mine] == [result.input_id]
    other = [
        item for item in harness.inputs_dao.items if item.project_id == other_project
    ]
    assert other[0].state == PendingInputState.pending


@pytest.mark.asyncio
async def test_a_refused_dispatch_writes_no_row():
    harness = _Harness()

    class Refused(Exception):
        pass

    harness.admission._refuse = lambda method, kwargs: Refused()

    with pytest.raises(Refused):
        await harness.enqueue()

    assert harness.inputs_dao.items == []


@pytest.mark.asyncio
async def test_server_code_keys_must_be_in_the_ag_namespace():
    harness = _Harness()

    with pytest.raises(ValueError):
        await harness.enqueue(key="child-update-1")


@pytest.mark.asyncio
async def test_the_request_must_name_the_session():
    harness = _Harness()

    with pytest.raises(ValueError):
        await harness.enqueue(content=_content(session_id="another-session"))


@pytest.mark.asyncio
async def test_concurrent_repeats_dispatch_once():
    harness = _Harness()

    results = await asyncio.gather(
        harness.enqueue(), harness.enqueue(), return_exceptions=True
    )

    assert harness.workflows.invoke_workflow_detached.await_count == 1
    assert len(harness.inputs_dao.items) == 1
    assert not any(isinstance(result, Exception) for result in results)
    assert results[0].input_id == results[1].input_id


# --- is_sent_by_person -------------------------------------------------------------


def _row(
    *,
    project_id=PROJECT_ID,
    kind=PendingInputKind.message,
    promoted_execution_id=None,
    idempotency_key=None,
):
    row = new_input_row(
        user_id=USER_ID,
        position=1,
        pending_input=PendingInputCreate(
            project_id=project_id,
            session_id=SESSION_ID,
            content={},
            policy="queue",
            kind=kind,
            idempotency_key=idempotency_key or str(uuid4()),
            request_fingerprint="f",
        ),
    )
    row.id = uuid4()
    row.state = "promoted" if promoted_execution_id else "pending"
    row.promoted_execution_id = promoted_execution_id
    return row


async def _sent_by_person(harness, execution_id):
    return await is_sent_by_person(
        executions_dao=harness.executions,
        inputs_dao=harness.inputs_dao,
        turns_dao=harness.turns,
        project_id=PROJECT_ID,
        session_id=SESSION_ID,
        execution_id=execution_id,
    )


@pytest.mark.asyncio
async def test_a_persons_message_into_an_idle_session_and_its_continuation():
    """An idle session writes no input row, so no row reads as `message`."""
    harness = _Harness()
    first, continuation = _ids(2)
    harness.turns.add(first, RunOrigin.WEB)
    harness.executions.add(continuation, parent=first)

    assert await _sent_by_person(harness, first) is True
    assert await _sent_by_person(harness, continuation) is True


@pytest.mark.asyncio
async def test_a_child_update_and_its_approval_continuation():
    harness = _Harness()
    first, continuation = _ids(2)
    # The update turn carries the calling turn's attribution (design D5).
    harness.turns.add(first, RunOrigin.WEB)
    harness.executions.add(continuation, parent=first)
    harness.inputs_dao.items.append(
        to_pending_input(
            _row(kind=PendingInputKind.child_update, promoted_execution_id=first)
        )
    )

    assert await _sent_by_person(harness, first) is False
    assert await _sent_by_person(harness, continuation) is False


@pytest.mark.asyncio
async def test_a_relayed_message_and_a_persons_own_turn_in_a_child_session():
    harness = _Harness()
    relayed, own = _ids(2)
    harness.turns.add(relayed, RunOrigin.CALLING_SESSION)
    harness.inputs_dao.items.append(
        to_pending_input(_row(promoted_execution_id=relayed))
    )
    harness.turns.add(own, RunOrigin.WEB)

    assert await _sent_by_person(harness, relayed) is False
    assert await _sent_by_person(harness, own) is True


@pytest.mark.parametrize(
    "origin, expected",
    [
        (RunOrigin.SCHEDULE, False),
        (RunOrigin.SUBSCRIPTION, False),
        (RunOrigin.EVALUATION, False),
        (RunOrigin.CHILD, False),
        (RunOrigin.API, True),
        (RunOrigin.INSTALLATION, True),
    ],
)
@pytest.mark.asyncio
async def test_the_run_origin_of_a_turn_with_no_input_row(origin, expected):
    """A schedule's first turn in a new session, a subscription turn, an API key turn."""
    harness = _Harness()
    [execution_id] = _ids(1)
    harness.turns.add(execution_id, origin)

    assert await _sent_by_person(harness, execution_id) is expected


@pytest.mark.asyncio
async def test_a_turn_with_no_row_or_no_origin_is_not_sent_by_a_person():
    harness = _Harness()
    missing, no_origin = _ids(2)
    harness.turns.add(no_origin, None)

    assert await _sent_by_person(harness, missing) is False
    assert await _sent_by_person(harness, no_origin) is False
    assert await _sent_by_person(harness, "not-a-uuid") is False


@pytest.mark.asyncio
async def test_a_turn_of_another_project_is_not_read():
    harness = _Harness()
    [execution_id] = _ids(1)
    harness.turns.add(execution_id, RunOrigin.WEB, project_id=uuid4())

    assert await _sent_by_person(harness, execution_id) is False


# --- reserved keys at the client entry points -------------------------------------


@pytest.mark.asyncio
async def test_the_admit_route_refuses_an_ag_key(monkeypatch):
    import oss.src.apis.fastapi.sessions.router as module
    from oss.src.apis.fastapi.sessions.router import SessionControlRouter

    inputs = AsyncMock()
    router = SessionControlRouter(commands_service=AsyncMock(), inputs_service=inputs)
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=str(PROJECT_ID), user_id=str(USER_ID)),
        headers={"Idempotency-Key": "ag:child_update:C:X1"},
    )
    payload = SimpleNamespace(session_id=SESSION_ID, content={}, on_busy="queue")

    async def allow(*_args, **_kwargs):
        return True

    monkeypatch.setattr(module, "allow_resource", allow)
    with pytest.raises(Exception) as raised:
        await router.admit_session_input(request, payload)

    assert getattr(raised.value, "status_code", None) == 422
    assert raised.value.detail["code"] == "idempotency_key_reserved"
    inputs.admit.assert_not_awaited()


def test_the_template_loader_refuses_an_ag_request_key():
    from oss.src.core.agent_templates.loader import AgentTemplateLoader

    with pytest.raises(SessionInputKeyReserved):
        AgentTemplateLoader._request_key(SimpleNamespace(request_key=" ag:start:x "))


# --- edit rules --------------------------------------------------------------------


class _EditableDAO(_InputsDAO):
    async def lock_pending_for_edit(self, *, project_id, session_id, input_id, **_):
        return await self.fetch_input(
            project_id=project_id, session_id=session_id, input_id=input_id
        )

    async def update_content(self, *, project_id, session_id, input_id, content, **_):
        item = await self.fetch_input(
            project_id=project_id, session_id=session_id, input_id=input_id
        )
        item.content = content
        return item


async def _queued(dao, *, envelope, kind=PendingInputKind.message):
    service = SessionInputsService(inputs_dao=dao, streams_service=_Streams())
    return service, await service.queue_input(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        session_id=SESSION_ID,
        content=_content("Ana's text."),
        idempotency_key=str(uuid4()),
        envelope=envelope,
        kind=kind,
    )


async def _edit(service, item, editor):
    from oss.src.core.sessions.inputs.dtos import PendingInputUpdate

    return await service.update(
        project_id=PROJECT_ID,
        session_id=SESSION_ID,
        input_id=item.id,
        user_id=editor,
        update=PendingInputUpdate(text="Ben's text."),
    )


def _text(item):
    return item.content["data"]["inputs"]["messages"][-1]["content"]


@pytest.mark.asyncio
async def test_the_sender_edits_her_own_queued_message():
    ana = uuid4()
    service, item = await _queued(
        _EditableDAO(), envelope=make_envelope(project_id=PROJECT_ID, principal_id=ana)
    )

    edited = await _edit(service, item, ana)

    assert _text(edited) == "Ben's text."


@pytest.mark.asyncio
async def test_another_member_cannot_edit_a_queued_message():
    from oss.src.core.sessions.inputs.types import SessionInputEditRefused

    ana, ben = uuid4(), uuid4()
    service, item = await _queued(
        _EditableDAO(), envelope=make_envelope(project_id=PROJECT_ID, principal_id=ana)
    )

    with pytest.raises(SessionInputEditRefused) as refused:
        await _edit(service, item, ben)

    assert refused.value.reason == "not_sender"
    assert _text(item) == "Ana's text."


@pytest.mark.asyncio
async def test_a_child_update_cannot_be_edited_even_by_its_sender():
    from oss.src.core.sessions.inputs.types import SessionInputEditRefused

    ana = uuid4()
    service, item = await _queued(
        _EditableDAO(),
        envelope=make_envelope(project_id=PROJECT_ID, principal_id=ana),
        kind=PendingInputKind.child_update,
    )

    with pytest.raises(SessionInputEditRefused) as refused:
        await _edit(service, item, ana)

    assert refused.value.reason == "server_input"
    assert _text(item) == "Ana's text."


@pytest.mark.asyncio
async def test_a_row_queued_with_an_api_key_can_only_be_removed():
    from oss.src.core.sessions.inputs.types import SessionInputEditRefused

    key_owner = uuid4()
    service, item = await _queued(
        _EditableDAO(), envelope=make_envelope(project_id=PROJECT_ID, kind="api_key")
    )

    with pytest.raises(SessionInputEditRefused):
        await _edit(service, item, key_owner)

    removed = await service.remove(
        project_id=PROJECT_ID,
        user_id=key_owner,
        session_id=SESSION_ID,
        input_id=item.id,
    )
    assert removed.state == PendingInputState.removed


def test_kind_is_in_the_response_and_no_request_can_set_it():
    from pydantic import ValidationError

    from oss.src.apis.fastapi.sessions.models import (
        PendingInputAdmissionRequest,
        PendingInputResponse,
    )

    item = to_pending_input(_row(kind=PendingInputKind.child_update))
    body = PendingInputResponse(input=item).model_dump(mode="json")
    assert body["input"]["kind"] == "child_update"
    assert "run_envelope" not in body["input"]
    assert to_pending_input(_row()).kind == PendingInputKind.message

    with pytest.raises(ValidationError):
        PendingInputAdmissionRequest(
            session_id=SESSION_ID, content={}, on_busy="queue", kind="child_update"
        )


def test_a_row_stored_before_the_column_reads_as_message():
    row = _row()
    row.kind = None
    assert to_pending_input(row).kind == PendingInputKind.message


def test_a_client_marker_in_content_does_not_change_the_kind():
    """`kind` comes only from the column, never from what the content says."""
    row = _row()
    row.content = {"kind": "child_update", "child_update": {"status": "completed"}}
    assert to_pending_input(row).kind == PendingInputKind.message
