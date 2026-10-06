"""A request_input form keeps its question order through the JSONB `attributes` column."""

from uuid import UUID, uuid4

from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.dbs.postgres.sessions.records.mappings import (
    map_record_dbe_to_dto,
    map_record_event_to_dbe,
)


_PROJECT = UUID("00000000-0000-0000-0000-0000000000ab")


def _form(*names):
    return {
        "message": "Three quick questions.",
        "requestedSchema": {
            "type": "object",
            "properties": {name: {"type": "string"} for name in names},
        },
    }


def _event(record_type, attributes):
    return SessionRecordEvent(
        project_id=_PROJECT,
        session_id="sess-order",
        record_id=uuid4(),
        record_type=record_type,
        attributes=attributes,
    )


def _jsonb_sorted(value):
    """What Postgres JSONB does to object keys: shorter first, then bytewise."""
    if isinstance(value, list):
        return [_jsonb_sorted(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {
        key: _jsonb_sorted(value[key])
        for key in sorted(value, key=lambda key: (len(key.encode()), key.encode()))
    }


def _round_trip(record_type, attributes):
    dbe = map_record_event_to_dbe(event=_event(record_type, attributes))
    dbe.attributes = _jsonb_sorted(dbe.attributes)
    return map_record_dbe_to_dto(dbe=dbe).attributes


def test_tool_call_form_reads_back_in_authored_order():
    attributes = {
        "name": "request_input",
        "input": _form("destination", "budget", "style"),
    }
    schema = _round_trip("tool_call", attributes)["input"]["requestedSchema"]
    assert list(schema["properties"]) == ["destination", "budget", "style"]
    assert schema["x-ag-order"] == ["destination", "budget", "style"]


def test_every_copy_in_an_interaction_request_reads_back_in_authored_order():
    form = _form("topic", "sources", "schedule", "delivery")
    attributes = {"payload": {"input": form, "toolCall": {"rawInput": form}}}
    payload = _round_trip("interaction_request", attributes)["payload"]
    expected = ["topic", "sources", "schedule", "delivery"]
    assert list(payload["input"]["requestedSchema"]["properties"]) == expected
    assert list(payload["toolCall"]["rawInput"]["requestedSchema"]["properties"]) == (
        expected
    )


def test_an_existing_order_is_kept():
    form = _form("b", "a")
    form["requestedSchema"]["x-ag-order"] = ["a", "b"]
    schema = _round_trip("tool_call", {"input": form})["input"]["requestedSchema"]
    assert list(schema["properties"]) == ["a", "b"]


def test_a_legacy_record_without_an_order_reads_back_as_stored():
    dbe = map_record_event_to_dbe(event=_event("agent_message", {"text": "hi"}))
    dbe.record_type = "tool_call"
    dbe.attributes = {"input": _jsonb_sorted(_form("style", "budget"))}
    schema = map_record_dbe_to_dto(dbe=dbe).attributes["input"]["requestedSchema"]
    assert list(schema["properties"]) == ["style", "budget"]


def test_other_record_types_are_not_touched():
    attributes = {"output": _form("b", "a")}
    dbe = map_record_event_to_dbe(event=_event("tool_result", attributes))
    assert "x-ag-order" not in dbe.attributes["output"]["requestedSchema"]


def test_the_event_is_not_mutated():
    event = _event("tool_call", {"input": _form("b", "a")})
    map_record_event_to_dbe(event=event)
    assert "x-ag-order" not in event.attributes["input"]["requestedSchema"]
