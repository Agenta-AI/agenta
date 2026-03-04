import zlib
from typing import List, Optional
from uuid import UUID

from orjson import dumps, loads
from pydantic import BaseModel
from redis.asyncio import Redis

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

from oss.src.core.tracing.dtos import OTelFlatSpan

log = get_module_logger(__name__)

_redis: Optional[Redis] = None


def _get_redis() -> Redis:
    global _redis

    if _redis is None:
        if not env.redis.uri_durable:
            raise RuntimeError("REDIS_URI_DURABLE is required for tracing streams.")
        _redis = Redis.from_url(env.redis.uri_durable, decode_responses=False)

    return _redis


class SpanMessage(BaseModel):
    organization_id: UUID
    project_id: UUID
    user_id: UUID
    #
    span_dto: OTelFlatSpan


def serialize_span(
    *,
    organization_id: UUID,
    project_id: UUID,
    user_id: UUID,
    #
    span_dto: OTelFlatSpan,
) -> bytes:
    data = dict(
        organization_id=organization_id.hex,
        project_id=project_id.hex,
        user_id=user_id.hex,
        span_dto=span_dto.model_dump(mode="json", exclude_unset=True),
    )

    span_bytes = dumps(data)

    # Strip null bytes from serialized data
    if b"\x00" in span_bytes:
        span_bytes = (
            span_bytes.decode("utf-8", "replace").replace("\x00", "").encode("utf-8")
        )

    # Compress with zlib for efficient storage
    return zlib.compress(span_bytes)


def deserialize_span(
    *,
    span_bytes: bytes,
) -> SpanMessage:
    span_bytes = zlib.decompress(span_bytes)
    data = loads(span_bytes)

    span_payload = data.get("span_dto", data.get("span", {}))

    return SpanMessage(
        organization_id=UUID(hex=data["organization_id"]),
        project_id=UUID(hex=data["project_id"]),
        user_id=UUID(hex=data["user_id"]),
        span_dto=OTelFlatSpan(**span_payload),
    )


async def publish_spans(
    *,
    organization_id: UUID,
    project_id: UUID,
    user_id: UUID,
    #
    span_dtos: List[OTelFlatSpan],
) -> int:
    redis = _get_redis()

    count = 0

    for span_dto in span_dtos:
        span_bytes = serialize_span(
            organization_id=organization_id,
            project_id=project_id,
            user_id=user_id,
            #
            span_dto=span_dto,
        )

        await redis.xadd(
            name="streams:tracing",
            fields={"data": span_bytes},
        )

        count += 1

    return count
