from typing import Any, Dict, List, Optional

from pydantic import TypeAdapter, ValidationError

from oss.src.core.sessions.records.dtos import (
    SESSION_DURABLE_EVENT_TYPES,
    SessionDurableEvent,
    SessionRecord,
)


_EVENT_ADAPTER = TypeAdapter(SessionDurableEvent)


def _validated_event(
    *, base: Dict[str, Any], event_type: str, payload: Dict[str, Any]
) -> Optional[SessionDurableEvent]:
    try:
        return _EVENT_ADAPTER.validate_python(
            {**base, "type": event_type, "payload": payload}
        )
    except ValidationError:
        return None


def _event_base(
    record: SessionRecord,
    *,
    entity_id: str,
    include_legacy: bool,
    watermark: int,
) -> Optional[Dict[str, Any]]:
    created_at = record.timestamp or record.created_at
    execution_id = record.turn_id or (record.attributes or {}).get("execution_id")
    if (
        (record.sequence is None and not include_legacy)
        or created_at is None
        or not execution_id
    ):
        return None
    return {
        "version": 1,
        "kind": "event",
        "session_id": record.session_id,
        "execution_id": str(execution_id),
        "frame_or_event_id": str(record.record_id),
        "entity_id": entity_id,
        "sequence": record.sequence,
        "watermark": watermark,
        "created_at": created_at,
    }


def _direct_event(
    record: SessionRecord, *, include_legacy: bool, watermark: int
) -> Optional[SessionDurableEvent]:
    if record.record_type not in SESSION_DURABLE_EVENT_TYPES:
        return None
    attributes = dict(record.attributes or {})
    payload = attributes.pop("payload", None)
    # `attributes` is an open dict filled from the ingest wire, so `payload` can be any JSON
    # value. A non-dict one must read as absent: `.get` on it raises outside the try below,
    # and that failure poisons the whole batch on every redelivery.
    if not isinstance(payload, dict):
        attributes.pop("type", None)
        attributes.pop("execution_id", None)
        payload = attributes
    entity_id = (
        payload.get("message_id")
        or payload.get("tool_call_id")
        or record.turn_id
        or attributes.get("execution_id")
    )
    base = _event_base(
        record,
        entity_id=str(entity_id or record.record_id),
        include_legacy=include_legacy,
        watermark=watermark,
    )
    if base is None:
        return None
    return _validated_event(base=base, event_type=record.record_type, payload=payload)


def durable_events_from_records(
    records: List[SessionRecord],
    *,
    include_legacy: bool = False,
    watermark: Optional[int] = None,
) -> List[SessionDurableEvent]:
    events: List[SessionDurableEvent] = []
    tool_calls: Dict[tuple[str, str], Dict[str, Any]] = {}
    resolved_watermark = (
        watermark
        if watermark is not None
        else max((record.sequence or 0 for record in records), default=0)
    )

    for record in records:
        # Some DAO decorators and legacy test doubles return commit sentinels rather than hydrated
        # rows. They still count as committed appends, but cannot describe a durable relay event.
        if not isinstance(record, SessionRecord):
            continue
        attributes = record.attributes or {}
        direct = _direct_event(
            record,
            include_legacy=include_legacy,
            watermark=resolved_watermark,
        )
        if direct is not None:
            events.append(direct)
            continue

        entity_id = str(
            attributes.get("message_id")
            or attributes.get("tool_call_id")
            or attributes.get("id")
            or record.record_id
        )
        base = _event_base(
            record,
            entity_id=entity_id,
            include_legacy=include_legacy,
            watermark=resolved_watermark,
        )
        if base is None:
            continue

        # Runner completion is persisted as `done`, including paused and cancelled turns.
        if record.record_type == "done":
            stop_reason = attributes.get("stopReason")
            event = _validated_event(
                base=base,
                event_type="execution.stopped",
                payload={
                    "stopped_at": base["created_at"],
                    "reason": stop_reason
                    if isinstance(stop_reason, str) and stop_reason
                    else "completed",
                },
            )
            if event is not None:
                events.append(event)
            continue

        if record.record_type in {"interaction_request", "interaction_response"}:
            payload = {
                "interaction_id": entity_id,
                "kind": attributes.get("kind"),
            }
            event = _validated_event(
                base=base,
                event_type=(
                    "interaction.requested"
                    if record.record_type == "interaction_request"
                    else "interaction.responded"
                ),
                payload=payload,
            )
            if event is not None:
                events.append(event)
            continue

        if record.record_type == "message":
            role = (
                "assistant" if record.record_source == "agent" else record.record_source
            )
            event = _validated_event(
                base=base,
                event_type="message.completed",
                payload={
                    "message_id": entity_id,
                    "role": role or "assistant",
                    "content": attributes.get("content", attributes.get("text", "")),
                    "finish_reason": attributes.get("finish_reason"),
                },
            )
            if event is not None:
                events.append(event)
            continue

        tool_key = (str(record.turn_id), entity_id)
        if record.record_type == "tool_call":
            tool_calls[tool_key] = attributes
            continue
        if record.record_type != "tool_result":
            continue

        call = tool_calls.get(tool_key, {})
        is_error = bool(attributes.get("isError"))
        output = attributes.get("data", attributes.get("output"))
        event = _validated_event(
            base=base,
            event_type="tool.completed",
            payload={
                "tool_call_id": entity_id,
                "name": str(call.get("name") or attributes.get("name") or "unknown"),
                "input": call.get("input", attributes.get("input")),
                "output": None if is_error else output,
                "error": output if is_error else None,
                "status": "error" if is_error else "completed",
            },
        )
        if event is not None:
            events.append(event)

    return events
