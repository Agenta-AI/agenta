import uuid_utils.compat as uuid

from oss.src.core.sessions.records.dtos import (
    SessionRecord,
    SessionRecordEvent,
)
from oss.src.dbs.postgres.sessions.records.dbes import RecordDBE


def map_record_event_to_dbe(
    *,
    event: SessionRecordEvent,
) -> RecordDBE:
    # The DAO inserts via an explicit insert().values(...), which bypasses the column's
    # ORM-side default=uuid7; mint the pk here so it is never null at insert.
    return RecordDBE(
        record_id=uuid.uuid7(),
        project_id=event.project_id,
        session_id=event.session_id,
        record_index=event.record_index,
        timestamp=event.timestamp,
        record_type=event.record_type,
        record_source=event.record_source,
        attributes=event.attributes,
    )


def map_record_dbe_to_dto(*, dbe: RecordDBE) -> SessionRecord:
    return SessionRecord(
        record_id=dbe.record_id,
        session_id=dbe.session_id,
        project_id=dbe.project_id,
        record_index=dbe.record_index,
        timestamp=dbe.timestamp,
        record_type=dbe.record_type,
        record_source=dbe.record_source,
        attributes=dbe.attributes,
        created_at=dbe.created_at,
    )
