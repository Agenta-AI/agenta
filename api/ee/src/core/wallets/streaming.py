"""Compressed-JSON `data` serializers for the two wallet streams, matching the shape used by
`oss/src/core/events/streaming.py`: orjson dumps with an asyncpg-`UUID`-aware default, then
zlib-compress; reverse for deserialization.

Pure functions over bytes plus publisher protocol declarations only — no Redis client, no
`xadd`. A later package supplies the concrete publisher.
"""

import zlib
from typing import Any, Protocol

from orjson import dumps, loads

try:
    from asyncpg.pgproto.pgproto import UUID as AsyncpgUUID
except ImportError:
    AsyncpgUUID = None

from ee.src.core.wallets.contracts import (
    CONTRACT_VERSION,
    DebitCommandV1,
    MeasurementCommandV1,
)
from ee.src.core.wallets.errors import MalformedEnvelopeError, UnsupportedVersionError


def _orjson_default(obj: Any):
    if AsyncpgUUID is not None and isinstance(obj, AsyncpgUUID):
        return str(obj)
    raise TypeError(f"Type is not JSON serializable: {type(obj)}")


def _serialize(command) -> bytes:
    payload = dumps(command.model_dump(mode="json"), default=_orjson_default)
    return zlib.compress(payload)


def _deserialize(payload: bytes, model):
    try:
        raw = loads(zlib.decompress(payload))
    except Exception as e:
        raise MalformedEnvelopeError(f"Could not decompress/parse envelope: {e}") from e

    version = raw.get("version")
    if version != CONTRACT_VERSION:
        raise UnsupportedVersionError(version=version)

    try:
        return model.model_validate(raw)
    except MalformedEnvelopeError:
        raise
    except Exception as e:
        raise MalformedEnvelopeError(f"Envelope failed validation: {e}") from e


def serialize_measurement_command(command: MeasurementCommandV1) -> bytes:
    return _serialize(command)


def deserialize_measurement_command(payload: bytes) -> MeasurementCommandV1:
    return _deserialize(payload, MeasurementCommandV1)


def serialize_debit_command(command: DebitCommandV1) -> bytes:
    return _serialize(command)


def deserialize_debit_command(payload: bytes) -> DebitCommandV1:
    return _deserialize(payload, DebitCommandV1)


class MeasurementPublisher(Protocol):
    """Publishes one `MeasurementCommandV1` to `streams:measurements`. Implemented by a
    later package; this is a structural declaration only."""

    async def publish(self, command: MeasurementCommandV1) -> bool: ...


class DebitPublisher(Protocol):
    """Publishes one `DebitCommandV1` to `streams:debits`. Implemented by a later package;
    this is a structural declaration only."""

    async def publish(self, command: DebitCommandV1) -> bool: ...
