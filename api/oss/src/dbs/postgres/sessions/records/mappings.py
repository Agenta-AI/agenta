from typing import Any, Callable, Dict, Optional

import uuid_utils.compat as uuid

from oss.src.core.sessions.records.dtos import (
    SessionRecord,
    SessionRecordEvent,
)
from oss.src.dbs.postgres.sessions.records.dbes import RecordDBE

# JSONB re-sorts object keys, so a request_input form's question order is kept in an array.
SCHEMA_ORDER_KEY = "x-ag-order"
FORM_RECORD_TYPES = frozenset({"tool_call", "interaction_request"})

Schema = Dict[str, Any]


def _map_form_schemas(value: Any, fn: Callable[[Schema], Schema]) -> Any:
    if isinstance(value, list):
        return [_map_form_schemas(item, fn) for item in value]
    if not isinstance(value, dict):
        return value
    mapped = {key: _map_form_schemas(item, fn) for key, item in value.items()}
    schema = mapped.get("requestedSchema")
    if isinstance(schema, dict) and isinstance(schema.get("properties"), dict):
        mapped["requestedSchema"] = fn(schema)
    return mapped


def _stamp_order(schema: Schema) -> Schema:
    if SCHEMA_ORDER_KEY in schema:
        return schema
    return {**schema, SCHEMA_ORDER_KEY: list(schema["properties"])}


def _apply_order(schema: Schema) -> Schema:
    order = schema.get(SCHEMA_ORDER_KEY)
    if not isinstance(order, list):
        return schema
    properties = schema["properties"]
    ordered = {
        name: properties[name]
        for name in order
        if isinstance(name, str) and name in properties
    }
    return {**schema, "properties": {**ordered, **properties}}


def _with_form_order(
    record_type: Optional[str],
    attributes: Optional[Dict[str, Any]],
    fn: Callable[[Schema], Schema],
) -> Optional[Dict[str, Any]]:
    if attributes is None or record_type not in FORM_RECORD_TYPES:
        return attributes
    return _map_form_schemas(attributes, fn)


def map_record_event_to_dbe(
    *,
    event: SessionRecordEvent,
) -> RecordDBE:
    # The DAO inserts via an explicit insert().values(...), which bypasses the column's
    # ORM-side default; mint the pk here so it is never null at insert. Honor a producer
    # stable id (uuid5) when supplied so retries/resumes upsert onto one row; else uuid4.
    return RecordDBE(
        project_id=event.project_id,
        session_id=event.session_id,
        record_id=event.record_id or uuid.uuid4(),
        sequence=None,
        record_index=event.record_index,
        timestamp=event.timestamp,
        record_type=event.record_type,
        record_source=event.record_source,
        attributes=_with_form_order(event.record_type, event.attributes, _stamp_order),
        turn_id=event.turn_id,
        span_id=event.span_id,
        quarantined_at=event.quarantined_at,
    )


def map_record_dbe_to_dto(*, dbe: RecordDBE) -> SessionRecord:
    return SessionRecord(
        record_id=dbe.record_id,
        session_id=dbe.session_id,
        project_id=dbe.project_id,
        sequence=dbe.sequence,
        record_index=dbe.record_index,
        timestamp=dbe.timestamp,
        record_type=dbe.record_type,
        record_source=dbe.record_source,
        attributes=_with_form_order(dbe.record_type, dbe.attributes, _apply_order),
        turn_id=dbe.turn_id,
        span_id=dbe.span_id,
        quarantined_at=dbe.quarantined_at,
        created_at=dbe.created_at,
    )
