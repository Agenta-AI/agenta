import uuid_utils.compat as uuid

from oss.src.core.sessions.transcripts.dtos import (
    SessionTranscript,
    SessionTranscriptEvent,
)
from oss.src.dbs.postgres.sessions.transcripts.dbes import TranscriptDBE


def map_transcript_event_to_dbe(
    *,
    event: SessionTranscriptEvent,
) -> TranscriptDBE:
    # The DAO inserts via an explicit insert().values(...), which bypasses the column's
    # ORM-side default=uuid7; mint the pk here so it is never null at insert.
    return TranscriptDBE(
        id=uuid.uuid7(),
        project_id=event.project_id,
        session_id=event.session_id,
        event_index=event.event_index,
        sender=event.sender,
        session_update=event.session_update,
        payload=event.payload,
    )


def map_transcript_dbe_to_dto(*, dbe: TranscriptDBE) -> SessionTranscript:
    return SessionTranscript(
        id=dbe.id,
        session_id=dbe.session_id,
        project_id=dbe.project_id,
        event_index=dbe.event_index,
        sender=dbe.sender,
        session_update=dbe.session_update,
        payload=dbe.payload,
        created_at=dbe.created_at,
    )
