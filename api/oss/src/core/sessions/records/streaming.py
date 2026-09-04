import zlib
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID

from orjson import dumps, loads
from pydantic import BaseModel

try:
    from asyncpg.pgproto.pgproto import UUID as AsyncpgUUID
except ImportError:
    AsyncpgUUID = None

from oss.src.core.sessions.records.dtos import SessionLiveFrame, SessionRecordEvent
from oss.src.dbs.redis.shared.engine import get_streams_engine
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# Truncate attributes at ingest to avoid storing unbounded record bodies.
MAX_ATTRIBUTES_BYTES = 64 * 1024  # 64 KB per record

_TRUNCATION_MARKER = "…[truncated]"

RECORD_STREAM_NAME = "streams:records"
LIVE_FRAME_STREAM_NAME = "streams:session-live-frames"
_FRAME_TRIM_INTERVAL = 64


def _orjson_default(obj):
    if AsyncpgUUID is not None and isinstance(obj, AsyncpgUUID):
        return str(obj)
    raise TypeError(f"Type is not JSON serializable: {type(obj)}")


def _truncate_attributes(attributes, budget: int, original_bytes: int):
    """Shrink an oversized record body to fit `budget` while PRESERVING structure: small fields
    (``type``/``id``/``name``…) stay intact and only the largest string values are trimmed, each
    marked, so server-side history reconstruction still gets the event shape + partial content.
    Falls back to a minimal discriminator-only shape when non-string bloat can't be trimmed."""
    if original_bytes <= budget:
        return attributes
    if not isinstance(attributes, dict):
        return {"_truncated": True, "_original_bytes": original_bytes}

    result = dict(attributes)
    trimmed: list[str] = []
    # Trim the largest string field repeatedly until the serialized body fits (or none remain).
    for _ in range(len(attributes)):
        size = len(dumps(result, default=_orjson_default))
        if size <= budget:
            break
        str_fields = [
            (k, v)
            for k, v in result.items()
            if isinstance(v, str) and not k.startswith("_")
        ]
        if not str_fields:
            break
        key, value = max(str_fields, key=lambda kv: len(kv[1]))
        overflow = size - budget
        keep = max(
            0, len(value) - overflow - 128
        )  # margin for the marker + json overhead
        result[key] = value[:keep] + _TRUNCATION_MARKER
        if key not in trimmed:
            trimmed.append(key)

    if len(dumps(result, default=_orjson_default)) > budget:
        # Non-string bloat remains → keep only the discriminator fields reconstruction needs.
        return {
            "type": attributes.get("type"),
            "id": attributes.get("id"),
            "_truncated": True,
            "_original_bytes": original_bytes,
        }

    result["_truncated"] = {"fields": trimmed, "original_bytes": original_bytes}
    return result


def _get_redis():
    engine = get_streams_engine()
    return engine.get_redis() if engine else None


async def trim_live_stream(redis) -> None:
    """Trim expired disposable frames independently of the durable record queue."""
    age_boundary = int(
        (
            datetime.now(timezone.utc).timestamp()
            - env.sessions.live_frame_max_age_seconds
        )
        * 1000
    )
    await redis.xtrim(
        LIVE_FRAME_STREAM_NAME,
        minid=f"{age_boundary}-0",
        approximate=False,
    )


class RecordMessage(BaseModel):
    """Wire format for the dedicated record Redis stream."""

    organization_id: Optional[UUID] = None
    project_id: UUID
    #
    record_event: SessionRecordEvent


class LiveFrameMessage(BaseModel):
    organization_id: Optional[UUID] = None
    project_id: UUID
    kind: Literal["frame"] = "frame"
    frame: SessionLiveFrame


def deserialize_record(*, payload: bytes) -> RecordMessage:
    return RecordMessage.model_validate(loads(zlib.decompress(payload)))


def deserialize_live_frame(*, payload: bytes) -> LiveFrameMessage:
    return LiveFrameMessage.model_validate(loads(zlib.decompress(payload)))


async def publish_live_frame(
    *,
    organization_id: Optional[UUID] = None,
    project_id: UUID,
    frame: SessionLiveFrame,
) -> bool:
    redis = _get_redis()
    if redis is None:
        log.warning("[RECORDS] Durable Redis not configured; frame not published")
        return False

    try:
        message = {
            "organization_id": str(organization_id) if organization_id else None,
            "project_id": str(project_id),
            "kind": "frame",
            "frame": frame.model_dump(mode="json"),
        }
        event_bytes = zlib.compress(dumps(message, default=_orjson_default))
        await redis.xadd(
            name=LIVE_FRAME_STREAM_NAME,
            fields={"data": event_bytes},
            maxlen=env.sessions.live_stream_maxlen,
            approximate=False,
        )
        if frame.frame_index % _FRAME_TRIM_INTERVAL == 0:
            try:
                await trim_live_stream(redis)
            except Exception:
                log.warning("[RECORDS] Live stream trim failed", exc_info=True)
        return True
    except Exception:
        log.error(
            "[RECORDS] Failed to publish frame",
            session_id=frame.session_id,
            execution_id=frame.execution_id,
            frame_index=frame.frame_index,
            exc_info=True,
        )
        return False


async def publish_record(
    *,
    organization_id: Optional[UUID] = None,
    project_id: UUID,
    #
    record_event: SessionRecordEvent,
) -> bool:
    redis = _get_redis()
    if redis is None:
        log.warning("[RECORDS] Durable Redis not configured; event not published")
        return False

    try:
        # Truncate attributes before publishing so oversized record bodies are
        # caught at the producer boundary, not after touching the DB.
        truncated_event = record_event
        if record_event.attributes is not None:
            raw_attributes = dumps(record_event.attributes, default=_orjson_default)
            if len(raw_attributes) > MAX_ATTRIBUTES_BYTES:
                log.warning(
                    "[RECORDS] Attributes truncated",
                    session_id=str(record_event.session_id),
                    original_bytes=len(raw_attributes),
                )
                # Smart truncation keeps the event shape + partial content so records stay
                # reconstructable; legacy path drops the whole body. Flag-gated (additive).
                new_attributes = (
                    _truncate_attributes(
                        record_event.attributes,
                        MAX_ATTRIBUTES_BYTES,
                        len(raw_attributes),
                    )
                    if env.agenta.sessions.records.smart_truncation
                    else {"_truncated": True}
                )
                truncated_event = record_event.model_copy(
                    update={"attributes": new_attributes}
                )

        message = {
            "organization_id": str(organization_id) if organization_id else None,
            "project_id": str(project_id),
            "record_event": truncated_event.model_dump(mode="json"),
        }

        event_bytes = dumps(message, default=_orjson_default)
        event_bytes = zlib.compress(event_bytes)

        await redis.xadd(
            name=RECORD_STREAM_NAME,
            fields={"data": event_bytes},
        )
        return True
    except Exception as e:
        log.error(f"[RECORDS] Failed to publish: {e}", exc_info=True)
        return False
