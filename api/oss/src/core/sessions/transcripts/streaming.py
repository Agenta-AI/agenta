import zlib
from typing import Optional
from uuid import UUID

from orjson import dumps, loads
from pydantic import BaseModel

try:
    from asyncpg.pgproto.pgproto import UUID as AsyncpgUUID
except ImportError:
    AsyncpgUUID = None

from oss.src.core.sessions.transcripts.dtos import TranscriptEvent
from oss.src.dbs.redis.shared.engine import get_streams_engine
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

MAXLEN_STREAMS_TRANSCRIPTS = 100_000

# Truncate payload at ingest to avoid storing unbounded event bodies.
MAX_PAYLOAD_BYTES = 64 * 1024  # 64 KB per event


def _orjson_default(obj):
    if AsyncpgUUID is not None and isinstance(obj, AsyncpgUUID):
        return str(obj)
    raise TypeError(f"Type is not JSON serializable: {type(obj)}")


def _get_redis():
    engine = get_streams_engine()
    return engine.get_redis() if engine else None


class TranscriptMessage(BaseModel):
    """Wire format for the dedicated transcript Redis stream."""

    organization_id: Optional[UUID] = None
    project_id: UUID
    #
    transcript_event: TranscriptEvent


def deserialize_transcript(*, payload: bytes) -> TranscriptMessage:
    payload = zlib.decompress(payload)
    raw = loads(payload)
    return TranscriptMessage.model_validate(raw)


async def publish_transcript(
    *,
    organization_id: Optional[UUID] = None,
    project_id: UUID,
    #
    transcript_event: TranscriptEvent,
) -> bool:
    redis = _get_redis()
    if redis is None:
        log.warning("[TRANSCRIPTS] Durable Redis not configured; event not published")
        return False

    try:
        # Truncate payload before publishing so oversized event bodies are
        # caught at the producer boundary, not after touching the DB.
        truncated_event = transcript_event
        if transcript_event.payload is not None:
            raw_payload = dumps(transcript_event.payload, default=_orjson_default)
            if len(raw_payload) > MAX_PAYLOAD_BYTES:
                log.warning(
                    "[TRANSCRIPTS] Payload truncated",
                    session_id=str(transcript_event.session_id),
                    original_bytes=len(raw_payload),
                )
                truncated_event = transcript_event.model_copy(
                    update={"payload": {"_truncated": True}}
                )

        message = {
            "organization_id": str(organization_id) if organization_id else None,
            "project_id": str(project_id),
            "transcript_event": truncated_event.model_dump(mode="json"),
        }

        event_bytes = dumps(message, default=_orjson_default)
        event_bytes = zlib.compress(event_bytes)

        await redis.xadd(
            name="streams:transcripts",
            fields={"data": event_bytes},
            maxlen=MAXLEN_STREAMS_TRANSCRIPTS,
            approximate=True,
        )
        return True
    except Exception as e:
        log.error(f"[TRANSCRIPTS] Failed to publish: {e}", exc_info=True)
        return False
