from oss.src.core.sessions.transcripts.dtos import Transcript, TranscriptEvent
from oss.src.dbs.postgres.sessions.transcripts.dbes import TranscriptDBE


def map_transcript_event_to_dbe(
    *,
    event: TranscriptEvent,
) -> TranscriptDBE:
    return TranscriptDBE(
        project_id=event.project_id,
        session_id=event.session_id,
        event_index=event.event_index,
        sender=event.sender,
        session_update=event.session_update,
        payload=event.payload,
    )


def map_transcript_dbe_to_dto(*, dbe: TranscriptDBE) -> Transcript:
    return Transcript(
        id=dbe.id,
        session_id=dbe.session_id,
        project_id=dbe.project_id,
        event_index=dbe.event_index,
        sender=dbe.sender,
        session_update=dbe.session_update,
        payload=dbe.payload,
        created_at=dbe.created_at,
    )
