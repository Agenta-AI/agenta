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


def test_maps_interaction_records_to_durable_lifecycle_events():
    records = [
        _record(
            sequence=1,
            record_type="interaction_request",
            attributes={
                "type": "interaction_request",
                "id": "interaction-1",
                "kind": "client_tool",
            },
        ),
        _record(
            sequence=2,
            record_type="interaction_response",
            attributes={
                "type": "interaction_response",
                "id": "interaction-1",
                "kind": "user_approval",
            },
        ),
    ]

    events = durable_events_from_records(records)

    assert [event.type for event in events] == [
        "interaction.requested",
        "interaction.responded",
    ]
    assert [event.sequence for event in events] == [1, 2]
    assert [event.watermark for event in events] == [2, 2]
    assert events[0].entity_id == "interaction-1"
    assert events[0].payload.interaction_id == "interaction-1"
    assert events[0].payload.kind == "client_tool"
    assert events[1].payload.kind == "user_approval"


def test_invalid_open_wire_strings_do_not_poison_durable_event_projection():
    records = [
        _record(
            sequence=1,
            record_type="interaction_request",
            attributes={"id": "interaction-1", "kind": {"invalid": True}},
        ),
        _record(
            sequence=2,
            record_type="message",
            attributes={"id": "message-1", "text": "bad", "finish_reason": 42},
        ),
        _record(
            sequence=3,
            record_type="message",
            attributes={"id": "message-2", "text": "kept", "finish_reason": "stop"},
        ),
    ]

    events = durable_events_from_records(records)

    assert [event.entity_id for event in events] == ["message-2"]
    assert events[0].payload.finish_reason == "stop"


def test_non_dict_payload_reads_as_absent_instead_of_raising():
    """A record whose `payload` attribute is not a dict must not poison the batch.

    `attributes` is an open dict filled from the ingest wire. Before this guard, a string or
    list `payload` raised `AttributeError` outside the projection's `try`, so the whole batch
    failed after its rows were committed and the same record returned on every redelivery.
    """
    records = [
        _record(
            sequence=1,
            record_type="execution.started",
            attributes={
                "payload": "not-a-dict",
                "started_at": datetime.now(timezone.utc).isoformat(),
            },
        ),
        _record(
            sequence=2,
            record_type="execution.started",
            attributes={
                "payload": ["also", "not", "a", "dict"],
                "started_at": datetime.now(timezone.utc).isoformat(),
            },
        ),
    ]

    events = durable_events_from_records(records)

    assert [event.type for event in events] == [
        "execution.started",
        "execution.started",
    ]
    assert [event.sequence for event in events] == [1, 2]


def test_maps_runner_done_records_to_terminal_events():
    for reason in (None, "paused", "cancelled"):
        attributes = {"type": "done"}
        if reason is not None:
            attributes["stopReason"] = reason
        record = _record(sequence=7, record_type="done", attributes=attributes)
        events = durable_events_from_records([record])
        assert len(events) == 1
        event = events[0]
        assert event.type == "execution.stopped"
        assert event.execution_id == record.turn_id
        assert event.sequence == 7
        assert event.watermark == 7
        assert event.payload.stopped_at == record.created_at
        assert event.payload.reason == (reason or "completed")
