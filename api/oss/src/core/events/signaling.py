"""Utilities for signaling events to the durable Redis stream."""

import json
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from redis.asyncio import Redis

from oss.src.core.events.dtos import EventIngestDTO, EventSignalDTO
from oss.src.core.events.queue import EVENTS_STREAM_NAME
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_redis: Optional[Redis] = None


def _to_jsonable(value: Any) -> Any:
    if isinstance(value, (UUID, datetime)):
        return str(value)
    if isinstance(value, dict):
        return {k: _to_jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_jsonable(v) for v in value]
    return value


def _get_redis() -> Optional[Redis]:
    global _redis

    if _redis is None and env.redis.uri_durable:
        _redis = Redis.from_url(env.redis.uri_durable, decode_responses=False)

    return _redis


async def signal_event(payload: EventSignalDTO | dict[str, Any]) -> bool:
    """Signal an event by pushing it into the durable Redis stream."""
    redis = _get_redis()
    if redis is None:
        log.warning("[EVENTS] Durable Redis is not configured; event was not signaled")
        return False

    try:
        normalized_payload: dict[str, Any]

        if isinstance(payload, EventSignalDTO):
            normalized_payload = EventIngestDTO(
                organization_id=payload.organization_id,
                project_id=payload.project_id,
                created_by_id=payload.user_id,
                flow_id=payload.flow_id,
                event_id=payload.event_id,
                flow_type=payload.flow_type,
                event_type=payload.event_type,
                event_name=payload.event_name,
                timestamp=payload.timestamp,
                status_code=payload.status_code,
                status_message=payload.status_message,
                attributes=payload.attributes,
            ).model_dump(mode="json")
        else:
            if "user_id" in payload and "created_by_id" not in payload:
                payload = {**payload, "created_by_id": payload["user_id"]}
            normalized_payload = EventIngestDTO.model_validate(payload).model_dump(
                mode="json"
            )

        payload_bytes = json.dumps(_to_jsonable(normalized_payload)).encode("utf-8")
        await redis.xadd(
            name=EVENTS_STREAM_NAME,
            fields={"data": payload_bytes},
        )
        return True
    except Exception as e:
        log.error(f"[EVENTS] Failed to signal event: {e}", exc_info=True)
        return False
