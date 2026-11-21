"""QA D8: the stored user `message` record of a turn that a child update started keeps
the update's structured part, read from the server-written input row only."""

from uuid import uuid4

import pytest

from oss.src.core.sessions.child_updates.dtos import (
    ChildTurnResult,
    ChildTurnStatus,
    stored_child_update_part,
)
from oss.src.core.sessions.child_updates.form import child_update_message
from oss.src.core.sessions.inputs.dtos import PendingInput, PendingInputKind
from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.core.sessions.records.service import RecordsService

PROJECT_ID = uuid4()
CALLING = "calling-session"
UPDATE_EXECUTION = "update-execution"
PART = {"session_id": "child-session", "turn_id": "child-turn", "status": "completed"}


class _RecordsDAO:
    def __init__(self):
        self.appended = []

    async def append_many(self, *, events):
        self.appended.extend(events)
        return []


class _InputsDAO:
    def __init__(self, rows=None, fail=False):
        self.rows = rows or {}
        self.fail = fail

    async def fetch_by_execution_id(self, *, project_id, session_id, execution_id):
        if self.fail:
            raise ConnectionError("database down")
        return self.rows.get((project_id, session_id, execution_id))


def _row(kind, content):
    return PendingInput(
        id=uuid4(),
        project_id=PROJECT_ID,
        session_id=CALLING,
        content=content,
        position=0,
        state="promoted",
        policy="queue",
        kind=kind,
        idempotency_key="ag:child_update:x",
        request_fingerprint="f",
        promoted_execution_id=UPDATE_EXECUTION,
    )


def _update_content():
    return {
        "session_id": CALLING,
        "data": {
            "inputs": {
                "messages": [{"role": "user", "content": "x", **{"child_update": PART}}]
            }
        },
    }


def _user_record(attributes=None, *, source="user", record_type="message"):
    return SessionRecordEvent(
        project_id=PROJECT_ID,
        session_id=CALLING,
        record_type=record_type,
        record_source=source,
        attributes={
            "type": "message",
            "text": "[Update from child ...]",
            **(attributes or {}),
        },
        turn_id=UPDATE_EXECUTION,
    )


async def _append(rows=None, events=None, fail=False):
    dao = _RecordsDAO()
    service = RecordsService(records_dao=dao, inputs_dao=_InputsDAO(rows, fail=fail))
    await service.append_many(events=events or [_user_record()])
    return dao.appended


def test_the_row_part_is_read_from_the_last_message():
    message = child_update_message(
        ChildTurnResult(
            session_id="child-session",
            turn_id="child-turn",
            status=ChildTurnStatus.completed,
        )
    )
    content = {"data": {"inputs": {"messages": [message]}}}

    assert stored_child_update_part(content) == PART
    assert stored_child_update_part({"data": {"inputs": {"messages": []}}}) is None
    assert stored_child_update_part({}) is None


@pytest.mark.asyncio
async def test_the_user_record_of_an_update_turn_keeps_the_part():
    rows = {
        (PROJECT_ID, CALLING, UPDATE_EXECUTION): _row(
            PendingInputKind.child_update, _update_content()
        )
    }

    [record] = await _append(rows)

    assert record.attributes["child_update"] == PART
    assert record.attributes["text"] == "[Update from child ...]"


@pytest.mark.asyncio
async def test_a_part_that_a_producer_sends_is_dropped():
    # A person's message (a queued `message` row) whose record claims to be an update.
    content = _update_content()
    rows = {
        (PROJECT_ID, CALLING, UPDATE_EXECUTION): _row(PendingInputKind.message, content)
    }

    [record] = await _append(rows, events=[_user_record({"child_update": PART})])

    assert "child_update" not in record.attributes


@pytest.mark.asyncio
async def test_a_turn_with_no_row_keeps_no_part():
    [record] = await _append({}, events=[_user_record({"child_update": PART})])

    assert "child_update" not in record.attributes


@pytest.mark.asyncio
async def test_an_agent_record_of_an_update_turn_gets_no_part():
    rows = {
        (PROJECT_ID, CALLING, UPDATE_EXECUTION): _row(
            PendingInputKind.child_update, _update_content()
        )
    }

    [record] = await _append(rows, events=[_user_record(source="agent")])

    assert "child_update" not in record.attributes


@pytest.mark.asyncio
async def test_a_failed_row_lookup_appends_the_record_with_its_text():
    [record] = await _append(fail=True)

    assert "child_update" not in record.attributes
    assert record.attributes["text"] == "[Update from child ...]"
