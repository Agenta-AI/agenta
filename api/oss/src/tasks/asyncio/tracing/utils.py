"""
Utilities for OTLP tracing ingestion worker.

Serialization/deserialization for Redis Streams transport.
"""

import zlib
from typing import Tuple
from uuid import UUID
from orjson import dumps, loads

from oss.src.core.tracing.dtos import OTelFlatSpan


def serialize_span(
    *,
    organization_id: UUID,
    project_id: UUID,
    user_id: UUID,
    span_dto: OTelFlatSpan,
) -> bytes:
    """
    Serialize span for Redis Streams with compression.

    Args:
        organization_id: Organization UUID
        project_id: Project UUID
        user_id: User UUID
        span_dto: Span to serialize

    Returns:
        Compressed serialized span bytes
    """
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
            span_bytes.decode("utf-8", "replace")
            .replace("\x00", "")
            .encode("utf-8")
        )

    # Compress with zlib for efficient storage
    return zlib.compress(span_bytes)


def deserialize_span(*, span_bytes: bytes) -> Tuple[UUID, UUID, UUID, OTelFlatSpan]:
    """
    Deserialize span from Redis Streams with decompression.

    Args:
        span_bytes: Compressed serialized span bytes

    Returns:
        Tuple of (organization_id, project_id, user_id, span_dto)
    """
    # Decompress with zlib
    decompressed = zlib.decompress(span_bytes)
    data = loads(decompressed)

    organization_id = UUID(hex=data["organization_id"])
    project_id = UUID(hex=data["project_id"])
    user_id = UUID(hex=data["user_id"])
    span_dto = OTelFlatSpan(**data["span_dto"])

    return (organization_id, project_id, user_id, span_dto)
