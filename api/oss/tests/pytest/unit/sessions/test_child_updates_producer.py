"""The producer of child updates (`SessionChildUpdatesService`, design D5 and D27).

Child inputs are written by fixtures, as the start and send handlers will write them: a
`message` row in the child session whose run envelope has the run origin
`calling_session`, with the server-owned `calling_turn_id`.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Dict, List, Optional
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from oss.src.core.access.dtos import RunContext, RunEnvelope, RunOrigin
from oss.src.core.sessions.child_updates.dtos import ChildTurnAgent
from oss.src.core.sessions.child_updates.service import (
    SessionChildUpdatesService,
    child_update_key,
    still_running_schedule_id,
)
from oss.src.core.sessions.executions.dtos import (
    SessionExecutionSettlement,
    SessionExecutionState,
)
from oss.src.core.sessions.inputs.dtos import (
    PendingInput,
    PendingInputKind,
    PendingInputState,
)
from oss.src.core.sessions.records.dtos import SessionRecord
from oss.src.core.sessions.types import SessionCallingSession, SessionReference
from oss.src.core.sharing.admission import QUEUED_DISPATCH_BOUNDARY
from oss.src.core.sharing.types import AdmissionDenied
from oss.src.core.access.dtos import Decision, DecisionReason
from oss.src.tasks.asyncio.sessions.child_updates_worker import (
    ChildUpdatesWorker,
    is_short_failure,
)
from oss.src.tasks.asyncio.sessions.streaming import SessionTurnEvent
from oss.tests.pytest.utils.principals import make_envelope

from sqlalchemy.exc import OperationalError


PROJECT_ID = uuid4()
OTHER_PROJECT_ID = uuid4()
SAM = uuid4()
CALLING = "chief-of-staff"
CHILD = "email-writer-child"
CALLING_TURN = str(uuid4())
CHILD_EXECUTION = str(uuid4())
CONTINUATION = str(uuid4())
WORKFLOW_ID = uuid4()
REVISION_ID = uuid4()
CALLING_WORKFLOW_ID = uuid4()
CALLING_REVISION_ID = uuid4()
SENDER_TEXT = "Draft a short reply to Globex."


def _child_envelope(*, origin_id: str = CALLING) -> RunEnvelope:
    return make_envelope(
        project_id=PROJECT_ID,
        principal_id=SAM,
        origin="calling_session",
        origin_id=origin_id,
        parent_run_id=CALLING_TURN,
    )


class _Inputs:
    """Session inputs of both sessions: the child input, and the updates the producer
    writes into the calling session."""

    def __init__(self):
        self.items: List[PendingInput] = []

    def add_child_input(
        self,
        *,
        execution_id: str = CHILD_EXECUTION,
        envelope: Optional[RunEnvelope] = None,
        calling_turn_id: Optional[str] = CALLING_TURN,
        kind: PendingInputKind = PendingInputKind.message,
        session_id: str = CHILD,
        project_id: UUID = PROJECT_ID,
    ) -> PendingInput:
        item = PendingInput(
            id=uuid4(),
            created_at=datetime.now(timezone.utc),
            created_by_id=SAM,
            project_id=project_id,
            session_id=session_id,
            content={
                "session_id": session_id,
                "data": {
                    "inputs": {"messages": [{"role": "user", "content": SENDER_TEXT}]}
                },
            },
            position=1,
            state=PendingInputState.promoted,
            policy="queue",
            kind=kind,
            idempotency_key=f"ag:start:{CALLING}:{CALLING_TURN}:call-1",
            request_fingerprint="fingerprint",
            promoted_execution_id=execution_id,
            run_envelope=envelope or _child_envelope(),
            calling_turn_id=calling_turn_id,
        )
        self.items.append(item)
        return item

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

    async def fetch_by_idempotency_key(
        self, *, project_id, session_id, idempotency_key, **_
    ):
        return next(
            (
                item
                for item in self.items
                if item.project_id == project_id
                and item.session_id == session_id
                and item.idempotency_key == idempotency_key
            ),
            None,
        )


class _Streams:
    def __init__(self):
        self.rows: Dict = {}
        self.add(CALLING, calling_session=None)
        self.add(CHILD)

    def add(self, session_id, *, calling_session=..., project_id=PROJECT_ID):
        if calling_session is ...:
            calling_session = SessionCallingSession(
                id=CALLING,
                turn_id=CALLING_TURN,
                agent_id=CALLING_WORKFLOW_ID,
                revision_id=CALLING_REVISION_ID,
            )
        self.rows[(project_id, session_id)] = SimpleNamespace(
            session_id=session_id,
            calling_session=calling_session,
            references=None,
        )

    async def get_by_session_id_including_archived(self, *, project_id, session_id):
        return self.rows.get((project_id, session_id))


class _Executions:
    def __init__(self):
        self.rows: Dict = {}

    def add(self, execution_id, *, parent=None, outcome=None, session_id=CHILD):
        self.rows[(PROJECT_ID, session_id, execution_id)] = SessionExecutionSettlement(
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
        return self.rows.get((project_id, session_id, execution_id))


class _Turns:
    def __init__(self):
        self.rows: Dict = {}
        self.add(
            CALLING,
            CALLING_TURN,
            origin=RunOrigin.WEB,
            workflow_id=CALLING_WORKFLOW_ID,
            revision_id=CALLING_REVISION_ID,
        )
        self.add(CHILD, CHILD_EXECUTION, origin=RunOrigin.CALLING_SESSION)

    def add(
        self,
        session_id,
        turn_id,
        *,
        origin,
        origin_id=None,
        turn_index=0,
        workflow_id=WORKFLOW_ID,
        revision_id=REVISION_ID,
    ):
        self.rows[(PROJECT_ID, session_id, UUID(turn_id))] = SimpleNamespace(
            turn_id=UUID(turn_id),
            turn_index=turn_index,
            context=RunContext(origin=origin, origin_id=origin_id),
            references=[
                SessionReference(key="workflow", id=workflow_id),
                SessionReference(key="workflow_revision", id=revision_id, version="7"),
            ],
            start_time=datetime(2026, 11, 20, 10, 2, 11, tzinfo=timezone.utc),
            end_time=datetime(2026, 11, 20, 10, 3, 40, tzinfo=timezone.utc),
            usage=None,
            trace_id=None,
        )

    async def find_turn(self, *, project_id, session_id, turn_id):
        return self.rows.get((project_id, session_id, turn_id))


class _Records:
    def __init__(self):
        self.records: List[SessionRecord] = []

    def add(self, turn_id, record_type, attributes=None, *, source="agent"):
        self.records.append(
            SessionRecord(
                record_id=uuid4(),
                project_id=PROJECT_ID,
                session_id=CHILD,
                record_type=record_type,
                record_source=source,
                attributes={"type": record_type, **(attributes or {})},
                turn_id=turn_id,
            )
        )

    async def get_execution_records(self, *, project_id, session_id, execution_ids):
        return [
            record
            for record in self.records
            if record.project_id == project_id
            and record.session_id == session_id
            and record.turn_id in execution_ids
        ]


class _Starts:
    """Records each helper call and writes the row, as the helper does."""

    def __init__(self, inputs: _Inputs, *, raises: Optional[Exception] = None):
        self.inputs = inputs
        self.calls: List[dict] = []
        self.raises = raises

    async def enqueue_session_input(self, **kwargs):
        self.calls.append(kwargs)
        if self.raises is not None:
            raise self.raises
        existing = await self.inputs.fetch_by_idempotency_key(
            project_id=kwargs["project_id"],
            session_id=kwargs["session_id"],
            idempotency_key=kwargs["idempotency_key"],
        )
        if existing is None:
            self.inputs.items.append(
                PendingInput(
                    id=uuid4(),
                    created_by_id=kwargs["user_id"],
                    project_id=kwargs["project_id"],
                    session_id=kwargs["session_id"],
                    content=kwargs["content"],
                    position=1,
                    state=PendingInputState.pending,
                    policy="queue",
                    kind=kwargs["kind"],
                    idempotency_key=kwargs["idempotency_key"],
                    request_fingerprint="fingerprint",
                    run_envelope=kwargs["run_envelope"],
                )
            )
        return SimpleNamespace(state=PendingInputState.pending)


class _Files:
    def __init__(self, *, fails=False):
        self.files: Dict = {}
        self.fails = fails

    async def get_or_create_session_cwd(self, *, project_id, user_id, session_id):
        return SimpleNamespace(id=uuid4(), session_id=session_id)

    async def write_file(self, *, project_id, mount_id, path, content):
        if self.fails:
            raise RuntimeError("store unavailable")
        self.files[path] = content.decode("utf-8")


class _Harness:
    def __init__(self, *, file_fails=False, starts_raises=None):
        self.inputs = _Inputs()
        self.streams = _Streams()
        self.executions = _Executions()
        self.turns = _Turns()
        self.records = _Records()
        self.starts = _Starts(self.inputs, raises=starts_raises)
        self.files = _Files(fails=file_fails)
        self.deleted: List = []

        async def delete(project_id, schedule_id):
            self.deleted.append((project_id, schedule_id))
            return False

        async def agent(project_id, workflow_id):
            return ChildTurnAgent(
                id=workflow_id, slug="email-writer", name="Email writer"
            )

        self.service = SessionChildUpdatesService(
            streams_dao=self.streams,
            inputs_dao=self.inputs,
            executions_dao=self.executions,
            turns_dao=self.turns,
            records_service=self.records,
            starts_service=self.starts,
            result_files=self.files,
            agent_lookup=agent,
            delete_still_running_schedule=delete,
            sleep=AsyncMock(),
        )

    async def ended(self, execution_id=CHILD_EXECUTION, *, project_id=PROJECT_ID):
        return await self.service.handle_turn_ended(
            project_id=project_id, session_id=CHILD, execution_id=execution_id
        )

    def updates(self) -> List[PendingInput]:
        return [
            item
            for item in self.inputs.items
            if item.kind == PendingInputKind.child_update
        ]

    def text(self, call: int = -1) -> str:
        messages = self.starts.calls[call]["content"]["data"]["inputs"]["messages"]
        return messages[-1]["content"]

    def part(self, call: int = -1) -> dict:
        messages = self.starts.calls[call]["content"]["data"]["inputs"]["messages"]
        return messages[-1]["child_update"]


def _completed(harness, execution_id=CHILD_EXECUTION, text="Here is the draft."):
    harness.records.add(execution_id, "message", {"text": text})
    harness.records.add(execution_id, "done", {"stopReason": "end_turn"})
    harness.executions.add(execution_id, outcome="completed")


# --- each ending --------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_completed_child_turn_enqueues_one_update_into_the_calling_session():
    harness = _Harness()
    child_input = harness.inputs.add_child_input()
    _completed(harness)

    await harness.ended()

    [call] = harness.starts.calls
    assert call["project_id"] == PROJECT_ID
    assert call["session_id"] == CALLING
    assert call["kind"] == PendingInputKind.child_update
    assert call["idempotency_key"] == child_update_key(
        child_session_id=CHILD, execution_id=CHILD_EXECUTION
    )
    assert call["idempotency_key"].startswith("ag:child_update:")
    assert call["dispatch_boundary"] == QUEUED_DISPATCH_BOUNDARY
    assert call["user_id"] == SAM
    assert call["content"]["session_id"] == CALLING
    assert call["content"]["references"] == {
        "workflow": {"id": str(CALLING_WORKFLOW_ID)},
        "workflow_revision": {"id": str(CALLING_REVISION_ID), "version": "7"},
    }
    assert harness.part() == {
        "session_id": CHILD,
        "turn_id": CHILD_EXECUTION,
        "status": "completed",
    }
    text = harness.text()
    assert text.startswith(
        "[Update from child session email-writer-child (Email writer)."
    )
    assert "status: completed" in text
    assert "<last_message>\nHere is the draft.\n</last_message>" in text
    assert f"result_path: child-sessions/{CHILD}/turn-0.md" in text
    assert "revision: 7" in text
    # The still-running schedule of this child input is deleted first.
    assert harness.deleted == [
        (
            PROJECT_ID,
            still_running_schedule_id(
                project_id=PROJECT_ID,
                calling_session_id=CALLING,
                child_input_id=child_input.id,
            ),
        )
    ]


@pytest.mark.asyncio
async def test_the_update_runs_with_the_calling_turns_origin_and_no_parent_or_approver():
    harness = _Harness()
    child = harness.inputs.add_child_input().run_envelope
    _completed(harness)

    await harness.ended()

    envelope = harness.starts.calls[0]["run_envelope"]
    assert envelope.authority == child.authority
    assert envelope.sender == child.sender
    assert envelope.context.origin == RunOrigin.WEB
    assert envelope.context.parent_run_id is None
    assert envelope.context.run_id is None
    assert envelope.approved_by is None


@pytest.mark.asyncio
async def test_a_project_agent_in_a_channel_keeps_the_installation_origin():
    harness = _Harness()
    binding = str(uuid4())
    turn = str(uuid4())
    harness.turns.add(CALLING, turn, origin=RunOrigin.INSTALLATION, origin_id=binding)
    harness.inputs.add_child_input(calling_turn_id=turn)
    _completed(harness)

    await harness.ended()

    context = harness.starts.calls[0]["run_envelope"].context
    assert context.origin == RunOrigin.INSTALLATION
    assert context.origin_id == binding


@pytest.mark.asyncio
async def test_a_failed_turn_reports_the_run_error_code_and_a_short_message():
    harness = _Harness()
    harness.inputs.add_child_input()
    harness.records.add(
        CHILD_EXECUTION,
        "error",
        {
            "code": "turn_time_limit_reached",
            "message": "x" * 500,
            "detail": {"secret": "never shown"},
        },
    )
    harness.records.add(CHILD_EXECUTION, "done", {"stopReason": "error"})
    harness.executions.add(CHILD_EXECUTION, outcome="failed")

    await harness.ended()

    text = harness.text()
    assert harness.part()["status"] == "failed"
    assert "error.code: turn_time_limit_reached" in text
    assert f"<error.message>\n{'x' * 300}\n</error.message>" in text
    assert "never shown" not in text
    assert f"child-sessions/{CHILD}/turn-0.md" in harness.files.files


@pytest.mark.asyncio
async def test_a_model_error_reports_failed_with_its_code():
    harness = _Harness()
    harness.inputs.add_child_input()
    harness.records.add(
        CHILD_EXECUTION,
        "error",
        {"code": "model_error", "message": "The provider refused the call."},
    )
    harness.records.add(CHILD_EXECUTION, "done", {"stopReason": "error"})

    await harness.ended()

    assert harness.part()["status"] == "failed"
    assert "error.code: model_error" in harness.text()


@pytest.mark.asyncio
async def test_a_lost_turn_reports_lost_from_the_settled_outcome():
    harness = _Harness()
    harness.inputs.add_child_input()
    harness.records.add(
        CHILD_EXECUTION,
        "error",
        {"code": "execution_lost", "message": "The run stopped reporting."},
    )
    harness.records.add(CHILD_EXECUTION, "done", {"settled_by": "watchdog"})
    harness.executions.add(CHILD_EXECUTION, outcome="lost")

    await harness.ended()

    assert harness.part()["status"] == "lost"
    assert "error.code: execution_lost" in harness.text()


@pytest.mark.parametrize(
    "cancelled_by, expected",
    [(None, "person"), ("steer", "person"), ("calling_session", "calling_session")],
)
@pytest.mark.asyncio
async def test_a_cancelled_turn_says_who_stopped_it(cancelled_by, expected):
    harness = _Harness()
    harness.inputs.add_child_input()
    attributes = {"stopReason": "cancelled"}
    if cancelled_by:
        attributes["cancelledBy"] = cancelled_by
    harness.records.add(CHILD_EXECUTION, "done", attributes)
    harness.executions.add(CHILD_EXECUTION, outcome="stopped")

    await harness.ended()

    assert harness.part()["status"] == "cancelled"
    assert f"cancelled_by: {expected}" in harness.text()


@pytest.mark.asyncio
async def test_a_killed_child_whose_runner_is_gone_reports_cancelled_by_a_person():
    """The kill settles the execution `stopped` by the watchdog; the sweep then writes
    one `done` with `stopReason: cancelled` and no `cancelledBy`."""
    harness = _Harness()
    harness.inputs.add_child_input()
    harness.executions.add(CHILD_EXECUTION, outcome="stopped")
    harness.records.add(
        CHILD_EXECUTION, "done", {"stopReason": "cancelled", "settled_by": "watchdog"}
    )

    await harness.ended()
    # A runner `done` that arrives later is quarantined, and its signal repeats.
    await harness.ended()

    assert len(harness.updates()) == 1
    assert harness.part(0)["status"] == "cancelled"
    assert "cancelled_by: person" in harness.text(0)


# --- a pause and an approval continuation -------------------------------------------


@pytest.mark.asyncio
async def test_a_pause_reports_what_it_waits_for_and_writes_no_file():
    harness = _Harness()
    harness.inputs.add_child_input()
    harness.records.add(
        CHILD_EXECUTION,
        "tool_call",
        {"id": "call-1", "name": "search_contacts", "input": {"q": "Globex"}},
    )
    harness.records.add(
        CHILD_EXECUTION, "tool_result", {"id": "call-1", "output": "3 contacts"}
    )
    harness.records.add(
        CHILD_EXECUTION,
        "interaction_request",
        {
            "id": "gate-1",
            "kind": "user_approval",
            "payload": {"toolName": "send_email"},
        },
    )
    harness.records.add(CHILD_EXECUTION, "done", {"stopReason": "paused"})

    await harness.ended()

    text = harness.text()
    assert harness.part()["status"] == "paused"
    assert (
        'waiting_for: [{"interaction_id": "gate-1", "kind": "user_approval", '
        '"tool": "send_email"}]'
    ) in text
    assert "result_path" not in text
    assert harness.files.files == {}
    # A paused child gets no still-running update either.
    assert len(harness.deleted) == 1


@pytest.mark.asyncio
async def test_an_approval_continuation_gives_a_second_update_with_one_turn_id():
    harness = _Harness()
    harness.inputs.add_child_input()
    harness.records.add(
        CHILD_EXECUTION,
        "tool_call",
        {"id": "call-1", "name": "search_contacts", "input": {"q": "Globex"}},
    )
    harness.records.add(
        CHILD_EXECUTION, "tool_result", {"id": "call-1", "output": "3 contacts"}
    )
    harness.records.add(
        CHILD_EXECUTION,
        "interaction_request",
        {
            "id": "gate-1",
            "kind": "user_approval",
            "payload": {"toolName": "send_email"},
        },
    )
    harness.records.add(CHILD_EXECUTION, "done", {"stopReason": "paused"})
    await harness.ended()

    harness.executions.add(CONTINUATION, parent=CHILD_EXECUTION)
    harness.records.add(
        CONTINUATION,
        "interaction_response",
        {"id": "gate-1", "kind": "user_approval", "payload": {"approved": True}},
    )
    harness.records.add(CONTINUATION, "message", {"text": "Sent the reply."})
    harness.records.add(CONTINUATION, "done", {"stopReason": "end_turn"})
    harness.executions.add(CONTINUATION, parent=CHILD_EXECUTION, outcome="completed")
    await harness.ended(CONTINUATION)

    keys = [item.idempotency_key for item in harness.updates()]
    assert keys == [
        child_update_key(child_session_id=CHILD, execution_id=CHILD_EXECUTION),
        child_update_key(child_session_id=CHILD, execution_id=CONTINUATION),
    ]
    assert [harness.part(0)["status"], harness.part(1)["status"]] == [
        "paused",
        "completed",
    ]
    assert harness.part(0)["turn_id"] == harness.part(1)["turn_id"] == CHILD_EXECUTION
    # The continuation's update runs with the calling turn's origin too.
    assert harness.starts.calls[1]["run_envelope"].context.origin == RunOrigin.WEB
    # One file holds the search, the approval and the steps after it.
    file = harness.files.files[f"child-sessions/{CHILD}/turn-0.md"]
    assert file.index("### Tool call: search_contacts") < file.index(
        "### Approval: send_email"
    )
    assert "<approved by a person>" in file
    assert file.index("### Approval: send_email") < file.index("Sent the reply.")
    assert CONTINUATION not in harness.text(1)


@pytest.mark.asyncio
async def test_the_turn_ended_signal_of_a_completed_continued_turn_is_a_repeat():
    """`complete_turn` names the turn's first execution; its update was the pause."""
    harness = _Harness()
    harness.inputs.add_child_input()
    harness.records.add(
        CHILD_EXECUTION,
        "interaction_request",
        {"id": "gate-1", "kind": "user_approval", "payload": {"toolName": "x"}},
    )
    harness.records.add(CHILD_EXECUTION, "done", {"stopReason": "paused"})
    await harness.ended()
    await harness.ended()

    assert len(harness.updates()) == 1


# --- who reports, and once only -----------------------------------------------------


@pytest.mark.asyncio
async def test_a_persons_turn_in_the_child_reports_to_nobody():
    harness = _Harness()
    person_turn = str(uuid4())
    harness.inputs.add_child_input(
        execution_id=person_turn,
        envelope=make_envelope(project_id=PROJECT_ID, principal_id=SAM, origin="web"),
    )
    _completed(harness, person_turn)

    await harness.ended(person_turn)

    assert harness.starts.calls == []


@pytest.mark.asyncio
async def test_a_persons_message_into_an_idle_child_writes_no_row_and_reports_to_nobody():
    harness = _Harness()
    _completed(harness)

    await harness.ended()

    assert harness.starts.calls == []


@pytest.mark.asyncio
async def test_a_session_that_is_not_a_child_reports_to_nobody():
    harness = _Harness()
    harness.streams.add(CHILD, calling_session=None)
    harness.inputs.add_child_input()
    _completed(harness)

    await harness.ended()

    assert harness.starts.calls == []


@pytest.mark.asyncio
async def test_a_turn_that_a_child_update_started_reports_to_nobody():
    """No loop: the calling session can itself be a child, and its update turn has a
    `child_update` input."""
    harness = _Harness()
    harness.inputs.add_child_input(kind=PendingInputKind.child_update)
    _completed(harness)

    await harness.ended()

    assert harness.starts.calls == []


@pytest.mark.asyncio
async def test_a_repeat_after_a_fuller_fold_writes_nothing_new():
    harness = _Harness()
    harness.inputs.add_child_input()
    _completed(harness, text="First part.")
    await harness.ended()
    harness.records.add(CHILD_EXECUTION, "message", {"text": "A late second part."})

    await harness.ended()

    [update] = harness.updates()
    assert (
        "A late second part."
        not in update.content["data"]["inputs"]["messages"][-1]["content"]
    )
    # The repeat sends the stored row again, so a dispatch left unfinished completes.
    assert harness.starts.calls[1]["content"] == update.content
    assert len(harness.deleted) == 1


@pytest.mark.asyncio
async def test_a_crash_between_the_delete_and_the_enqueue_gives_one_update_on_retry():
    harness = _Harness(starts_raises=OperationalError("enqueue", {}, Exception()))
    harness.inputs.add_child_input()
    _completed(harness)

    with pytest.raises(OperationalError):
        await harness.ended()
    assert harness.updates() == []
    assert len(harness.deleted) == 1

    harness.starts.raises = None
    await harness.ended()

    assert len(harness.updates()) == 1
    assert len(harness.deleted) == 2  # the delete of a gone schedule changes nothing


@pytest.mark.asyncio
async def test_a_deleted_calling_session_is_logged_and_not_retried():
    harness = _Harness()
    del harness.streams.rows[(PROJECT_ID, CALLING)]
    harness.inputs.add_child_input()
    _completed(harness)

    assert await harness.ended() is None
    assert harness.starts.calls == []


@pytest.mark.asyncio
async def test_a_calling_turn_with_no_row_writes_no_update():
    harness = _Harness()
    harness.inputs.add_child_input(calling_turn_id=str(uuid4()))
    _completed(harness)

    assert await harness.ended() is None
    assert harness.starts.calls == []


@pytest.mark.asyncio
async def test_the_calling_turn_is_read_by_calling_turn_id_never_by_parent_run_id():
    """After an approval, the calling execution is a continuation: `parent_run_id`
    names no turn row. The stored first execution id does."""
    harness = _Harness()
    continuation = str(uuid4())
    envelope = make_envelope(
        project_id=PROJECT_ID,
        principal_id=SAM,
        origin="calling_session",
        origin_id=CALLING,
        parent_run_id=continuation,
    )
    harness.inputs.add_child_input(envelope=envelope, calling_turn_id=CALLING_TURN)
    _completed(harness)

    await harness.ended()

    assert harness.starts.calls[0]["run_envelope"].context.origin == RunOrigin.WEB


@pytest.mark.asyncio
async def test_a_signal_of_another_project_finds_nothing():
    harness = _Harness()
    harness.inputs.add_child_input()
    _completed(harness)

    assert await harness.ended(project_id=OTHER_PROJECT_ID) is None
    assert harness.starts.calls == []


@pytest.mark.asyncio
async def test_a_child_input_that_names_another_calling_session_is_refused():
    harness = _Harness()
    harness.inputs.add_child_input(envelope=_child_envelope(origin_id="other-session"))
    _completed(harness)

    assert await harness.ended() is None
    assert harness.starts.calls == []


# --- the result file ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_failed_file_write_still_sends_the_update_without_a_path():
    harness = _Harness(file_fails=True)
    harness.inputs.add_child_input()
    _completed(harness)

    await harness.ended()

    assert len(harness.updates()) == 1
    assert "result_path" not in harness.text()


@pytest.mark.asyncio
async def test_the_first_turn_file_is_turn_0_with_the_same_heading():
    harness = _Harness()
    harness.inputs.add_child_input()
    _completed(harness)

    await harness.ended()

    file = harness.files.files[f"child-sessions/{CHILD}/turn-0.md"]
    assert file.startswith("# Email writer, turn 0\n")
    assert f"## Sent\n{SENDER_TEXT}\n" in file
    assert "## Last message\nHere is the draft.\n" in file


@pytest.mark.asyncio
async def test_a_long_report_is_cut_in_the_update_and_whole_in_the_file():
    harness = _Harness()
    harness.inputs.add_child_input()
    report = "r" * 40_000
    _completed(harness, text=report)

    await harness.ended()

    text = harness.text()
    assert "is_truncated: true" in text
    assert f"<last_message>\n{'r' * 8000}\n</last_message>" in text
    assert report in harness.files.files[f"child-sessions/{CHILD}/turn-0.md"]


@pytest.mark.asyncio
async def test_the_ending_is_read_again_when_the_signal_outruns_the_records():
    harness = _Harness()
    harness.inputs.add_child_input()
    reads = {"count": 0}
    original = harness.records.get_execution_records

    async def late(**kwargs):
        reads["count"] += 1
        if reads["count"] == 2:
            _completed(harness)
        return await original(**kwargs)

    harness.records.get_execution_records = late

    await harness.ended()

    assert reads["count"] == 2
    assert harness.part()["status"] == "completed"


@pytest.mark.asyncio
async def test_a_settled_execution_waits_for_its_last_records():
    harness = _Harness()
    harness.inputs.add_child_input()
    harness.executions.add(CHILD_EXECUTION, outcome="completed")
    reads = {"count": 0}
    original = harness.records.get_execution_records

    async def late(**kwargs):
        reads["count"] += 1
        if reads["count"] == 2:
            harness.records.add(CHILD_EXECUTION, "message", {"text": "The answer."})
            harness.records.add(CHILD_EXECUTION, "done", {"stopReason": "end_turn"})
        return await original(**kwargs)

    harness.records.get_execution_records = late

    await harness.ended()

    assert reads["count"] == 2
    assert harness.part()["status"] == "completed"
    assert (
        "The answer."
        in harness.starts.calls[0]["content"]["data"]["inputs"]["messages"][-1][
            "content"
        ]
    )


# --- the consumer's failure rule ----------------------------------------------------


def _entry(execution_id=CHILD_EXECUTION, kind="turn_ended"):
    event = SessionTurnEvent(
        kind=kind, project_id=PROJECT_ID, session_id=CHILD, turn_id=execution_id
    )
    return b"1-0", {b"data": event.model_dump_json().encode()}


@pytest.mark.asyncio
async def test_a_database_outage_leaves_the_signal_pending_and_the_retry_writes_once():
    harness = _Harness(starts_raises=OperationalError("enqueue", {}, Exception()))
    harness.inputs.add_child_input()
    _completed(harness)
    worker = ChildUpdatesWorker(
        service=harness.service, redis_client=AsyncMock(), stream_name="test"
    )

    _, acked = await worker.process_batch([_entry()])
    assert acked == []

    harness.starts.raises = None
    _, acked = await worker.process_batch([_entry()])
    _, acked_again = await worker.process_batch([_entry()])

    assert acked == [b"1-0"] and acked_again == [b"1-0"]
    assert len(harness.updates()) == 1


@pytest.mark.asyncio
async def test_a_refused_admission_is_logged_and_acknowledged():
    refusal = AdmissionDenied(
        decision=Decision(allowed=False, reason=DecisionReason.ROLE),
        readable=True,
        boundary=QUEUED_DISPATCH_BOUNDARY,
    )
    harness = _Harness(starts_raises=refusal)
    harness.inputs.add_child_input()
    _completed(harness)
    worker = ChildUpdatesWorker(
        service=harness.service, redis_client=AsyncMock(), stream_name="test"
    )

    _, acked = await worker.process_batch([_entry()])

    assert acked == [b"1-0"]


@pytest.mark.asyncio
async def test_a_turn_started_signal_is_acknowledged_without_work():
    harness = _Harness()
    worker = ChildUpdatesWorker(
        service=harness.service, redis_client=AsyncMock(), stream_name="test"
    )

    _, acked = await worker.process_batch([_entry(kind="turn_started")])

    assert acked == [b"1-0"]
    assert harness.starts.calls == []


def test_only_outages_and_an_unproven_dispatch_are_short_failures():
    from redis.exceptions import ConnectionError as RedisConnectionError

    assert is_short_failure(OperationalError("x", {}, Exception()))
    assert is_short_failure(RedisConnectionError())
    assert not is_short_failure(ValueError("bad input"))
    assert not is_short_failure(
        AdmissionDenied(
            decision=Decision(allowed=False, reason=DecisionReason.ROLE),
            readable=True,
            boundary=QUEUED_DISPATCH_BOUNDARY,
        )
    )


@pytest.mark.asyncio
async def test_an_unproven_dispatch_is_retried_but_dropped_past_the_budget():
    from oss.src.core.sessions.starts.types import SessionStartNotDurable

    harness = _Harness(starts_raises=SessionStartNotDurable())
    harness.inputs.add_child_input()
    _completed(harness)
    worker = ChildUpdatesWorker(
        service=harness.service, redis_client=AsyncMock(), stream_name="test"
    )

    _, acked = await worker.process_batch([_entry()])

    assert acked == []
    assert worker.is_permanent_failure(b"1-0", {})
    # Once dropped, the entry is forgotten.
    assert not worker.is_permanent_failure(b"1-0", {})


@pytest.mark.asyncio
async def test_an_outage_is_never_dropped_past_the_budget():
    harness = _Harness(starts_raises=OperationalError("enqueue", {}, Exception()))
    harness.inputs.add_child_input()
    _completed(harness)
    worker = ChildUpdatesWorker(
        service=harness.service, redis_client=AsyncMock(), stream_name="test"
    )

    _, acked = await worker.process_batch([_entry()])

    assert acked == []
    assert not worker.is_permanent_failure(b"1-0", {})
