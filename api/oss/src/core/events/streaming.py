from typing import Optional
from uuid import UUID

from orjson import dumps, loads
from pydantic import BaseModel
from redis.asyncio import Redis

from oss.src.core.events.dtos import Event
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_redis: Optional[Redis] = None


def _get_redis() -> Optional[Redis]:
    global _redis

    if _redis is None and env.redis.uri_durable:
        _redis = Redis.from_url(env.redis.uri_durable, decode_responses=False)

    return _redis


class EventMessage(BaseModel):
    """Wire format for the Redis events stream — carries scope alongside the event."""

    organization_id: Optional[UUID] = None
    project_id: UUID
    #
    event: Event

    def to_event(self) -> Event:
        return self.event


def deserialize_event(*, payload: bytes) -> EventMessage:
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
    workspace_id: Optional[UUID] = None,
    project_id: Optional[UUID] = None,
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
            "organization_id": organization_id,
            "workspace_id": workspace_id,
            "project_id": project_id,
            "user_id": user_id,
            "event": event.model_dump(mode="json"),
        }

        await redis.xadd(
            name="streams:events",
            fields={"data": dumps(message)},
        )
        return True
    except Exception as e:
        log.error(f"[EVENTS] Failed to publish event: {e}", exc_info=True)
        return False
