import json
from typing import Any

from oss.src.core.events.dtos import EventIngestDTO


def serialize_event(*, payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, default=str).encode("utf-8")


def deserialize_event(*, payload: bytes) -> EventIngestDTO:
    return EventIngestDTO.model_validate(json.loads(payload.decode("utf-8")))
