from datetime import datetime, timezone
from uuid import uuid4

from oss.src.core.sessions.records.dtos import SessionRecord
from oss.src.core.sessions.records.events import durable_events_from_records


def _record(*, sequence: int, record_type: str, attributes: dict, source="agent"):
    return SessionRecord(
        project_id=uuid4(),
        session_id="session-1",
        record_id=uuid4(),
        sequence=sequence,
        turn_id="execution-1",
        record_type=record_type,
        record_source=source,
        attributes=attributes,
        created_at=datetime.now(timezone.utc),
    )


def test_maps_message_and_completed_tool_to_versioned_durable_events():
    records = [
        _record(
            sequence=1,
            record_type="message",
            source="user",
            attributes={"type": "message", "id": "message-1", "text": "hello"},
        ),
        _record(
            sequence=2,
            record_type="tool_call",
            attributes={
                "type": "tool_call",
                "id": "tool-1",
                "name": "read",
                "input": {"path": "README.md"},
            },
        ),
        _record(
            sequence=3,
            record_type="tool_result",
            attributes={"type": "tool_result", "id": "tool-1", "output": "ok"},
        ),
    ]

    events = durable_events_from_records(records)

    assert [event.type for event in events] == ["message.completed", "tool.completed"]
    assert [event.sequence for event in events] == [1, 3]
    assert [event.watermark for event in events] == [3, 3]
    assert events[0].payload.role == "user"
    assert events[1].payload.name == "read"
    assert events[1].payload.input == {"path": "README.md"}
    assert events[1].payload.output == "ok"


def test_accepts_the_six_direct_event_types_and_ignores_unknown_types():
    records = [
        _record(
            sequence=1,
            record_type="execution.started",
            attributes={"started_at": datetime.now(timezone.utc).isoformat()},
        ),
        _record(
            sequence=2,
            record_type="future.event",
            attributes={"value": True},
        ),
    ]

    events = durable_events_from_records(records)

    assert len(events) == 1
    assert events[0].type == "execution.started"
    assert events[0].sequence == 1
    assert events[0].watermark == 2
