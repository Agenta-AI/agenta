import zlib
from typing import Optional
from uuid import UUID

from orjson import dumps, loads
from pydantic import BaseModel

try:
    from asyncpg.pgproto.pgproto import UUID as AsyncpgUUID
except ImportError:
    AsyncpgUUID = None

from oss.src.core.events.dtos import Event
from oss.src.dbs.redis.shared.engine import get_streams_engine
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


def _orjson_default(obj):
    if AsyncpgUUID is not None and isinstance(obj, AsyncpgUUID):
        return str(obj)
    raise TypeError(f"Type is not JSON serializable: {type(obj)}")


def _get_redis():
    engine = get_streams_engine()
    return engine.get_redis() if engine else None


class EventMessage(BaseModel):
    """Wire format for the Redis events stream — carries scope alongside the event."""

    organization_id: Optional[UUID] = None
    project_id: UUID
    #
    event: Event

    def to_event(self) -> Event:
        return self.event


def deserialize_event(*, payload: bytes) -> EventMessage:
    payload = zlib.decompress(payload)
    raw = loads(payload)
    # Support legacy flat format: scope fields at root level alongside event fields
    if "event" not in raw:
        organization_id = raw.pop("organization_id", None)
        project_id = raw.pop("project_id")
        raw.pop("user_id", None)  # discarded — events are system-generated
        return EventMessage(
            organization_id=organization_id,
            project_id=project_id,
            event=Event.model_validate(raw),
        )
    return EventMessage.model_validate(raw)


async def publish_event(
    *,
    organization_id: Optional[UUID] = None,
    project_id: UUID,
    user_id: Optional[UUID] = None,
    #
    event: Event,
) -> bool:
    redis = _get_redis()
    if redis is None:
        log.warning("[EVENTS] Durable Redis is not configured; event was not published")
        return False

    try:
        message = {
            "organization_id": str(organization_id) if organization_id else None,
            "project_id": str(project_id),
            "user_id": str(user_id) if user_id else None,
            "event": event.model_dump(mode="json"),
        }

        event_bytes = dumps(message, default=_orjson_default)
        event_bytes = zlib.compress(event_bytes)

        await redis.xadd(
            name="streams:events",
            fields={"data": event_bytes},
        )
        return True
    except Exception as e:
        log.error(f"[EVENTS] Failed to publish event: {e}", exc_info=True)
        return False
