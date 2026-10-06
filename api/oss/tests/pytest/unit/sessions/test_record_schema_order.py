"""Ingest keeps a `request_input` form's question order through the JSONB column.

`records.attributes` is JSONB, which re-sorts object keys, and a form's question order is its
`requestedSchema.properties` order. Both write paths of `RecordsService` stamp that order into
`x-ag-order` before the DAO sees the event.
"""

from typing import List, Optional
from uuid import UUID, uuid4

import pytest

from oss.src.core.sessions.records.dtos import SessionRecord, SessionRecordEvent
from oss.src.core.sessions.records.interfaces import RecordsDAOInterface
from oss.src.core.sessions.records.service import RecordsService


_PROJECT = UUID("00000000-0000-0000-0000-0000000000ab")


class _RecordingDAO(RecordsDAOInterface):
    def __init__(self):
        self.appended: List[SessionRecordEvent] = []

    async def settled_turns(self, *, project_id, keys, settled_by=None):
        return set()

    async def append(self, *, event, session=None) -> Optional[SessionRecord]:
        self.appended.append(event)
        return None

    async def append_many(self, *, events) -> List[SessionRecord]:
        self.appended.extend(events)
        return []


def _tool_call(names: List[str]) -> SessionRecordEvent:
    return SessionRecordEvent(
        project_id=_PROJECT,
        session_id="sess-order",
        record_id=uuid4(),
        record_type="tool_call",
        record_source="agent",
        turn_id="turn-order",
        attributes={
            "type": "tool_call",
            "name": "request_input",
            "input": {
                "message": "Three quick questions.",
                "requestedSchema": {
                    "type": "object",
                    "properties": {name: {"type": "string"} for name in names},
                },
            },
        },
    )


@pytest.mark.asyncio
async def test_append_many_stamps_the_authored_order():
    dao = _RecordingDAO()
    await RecordsService(records_dao=dao).append_many(
        events=[_tool_call(["destination", "budget", "style"])]
    )
    schema = dao.appended[0].attributes["input"]["requestedSchema"]
    assert schema["x-ag-order"] == ["destination", "budget", "style"]


@pytest.mark.asyncio
async def test_append_stamps_the_authored_order():
    dao = _RecordingDAO()
    await RecordsService(records_dao=dao).append(
        event=_tool_call(["topic", "sources", "schedule", "delivery"])
    )
    schema = dao.appended[0].attributes["input"]["requestedSchema"]
    assert schema["x-ag-order"] == ["topic", "sources", "schedule", "delivery"]
