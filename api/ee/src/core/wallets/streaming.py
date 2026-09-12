"""Compressed-JSON `data` serializers for the two wallet streams, matching the shape used by
`oss/src/core/events/streaming.py`: orjson dumps with an asyncpg-`UUID`-aware default, then
zlib-compress; reverse for deserialization.

Also the concrete best-effort publishers (`RedisMeasurementPublisher`,
`RedisDebitPublisher`) — same compressed `data` field, bounded approximate
`MAXLEN`, log-and-return-`False` on any failure, never raise into the caller.
"""

import zlib
from typing import Any, Protocol

from orjson import dumps, loads

try:
    from asyncpg.pgproto.pgproto import UUID as AsyncpgUUID
except ImportError:
    AsyncpgUUID = None

from oss.src.dbs.redis.shared.engine import get_streams_engine
from oss.src.utils.logging import get_module_logger

from ee.src.core.wallets.contracts import (
    CONTRACT_VERSION,
    STREAM_DEBITS,
    STREAM_MEASUREMENTS,
    DebitCommandV1,
    MeasurementCommandV1,
)
from ee.src.core.wallets.errors import MalformedEnvelopeError, UnsupportedVersionError

log = get_module_logger(__name__)

# Bound each stream so consumed entries are trimmed; without this it grows unbounded.
MAXLEN_STREAMS_MEASUREMENTS = 100_000
MAXLEN_STREAMS_DEBITS = 100_000


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


def _get_redis():
    engine = get_streams_engine()
    return engine.get_redis() if engine else None


async def _xadd(*, stream: str, payload: bytes, maxlen: int) -> bool:
    try:
        redis = _get_redis()
        if redis is None:
            log.warning(
                f"[WALLETS] Durable Redis is not configured; {stream} was not published"
            )
            return False

        await redis.xadd(
            name=stream,
            fields={"data": payload},
            maxlen=maxlen,
            approximate=True,
        )
        return True
    except Exception as e:
        log.error(f"[WALLETS] Failed to publish to {stream}: {e}", exc_info=True)
        return False


class RedisMeasurementPublisher:
    """Best-effort `streams:measurements` publisher — the API request calls this
    after it already has the managed gateway result. A failed publish means no
    persisted measurement and no debit; it must never change the caller's
    already-successful result, so this never raises."""

    async def publish(self, command: MeasurementCommandV1) -> bool:
        return await _xadd(
            stream=STREAM_MEASUREMENTS,
            payload=serialize_measurement_command(command),
            maxlen=MAXLEN_STREAMS_MEASUREMENTS,
        )


class RedisDebitPublisher:
    """Best-effort `streams:debits` publisher — used only by the measurement
    worker, and only for a charge it has already decided to make."""

    async def publish(self, command: DebitCommandV1) -> bool:
        return await _xadd(
            stream=STREAM_DEBITS,
            payload=serialize_debit_command(command),
            maxlen=MAXLEN_STREAMS_DEBITS,
        )
