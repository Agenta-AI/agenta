"""Compressed-JSON `data` serializers for the two wallet streams, and the publisher
contracts. The Redis publishers live in
`ee/src/dbs/redis/wallets/streams.py`.
"""

import zlib
from typing import Protocol

from orjson import dumps, loads

from ee.src.core.wallets.contracts import (
    CONTRACT_VERSION,
    DebitCommandV1,
    MeasurementCommandV1,
)
from ee.src.core.wallets.errors import MalformedEnvelopeError, UnsupportedVersionError


def _serialize(command) -> bytes:
    payload = dumps(command.model_dump(mode="json"))
    return zlib.compress(payload)


def _deserialize(payload: bytes, model):
    try:
        raw = loads(zlib.decompress(payload))
    except Exception as e:
        raise MalformedEnvelopeError(f"Could not decompress/parse envelope: {e}") from e

    if not isinstance(raw, dict):
        # `[]`, `"text"` and `1` all decompress and parse, then die on `.get` with an
        # AttributeError, which is not a `WalletTerminalError` — so the worker would treat
        # a payload no redelivery can fix as transient and leave it pending forever.
        raise MalformedEnvelopeError(
            f"Envelope is not a JSON object: {type(raw).__name__}"
        )

    version = raw.get("version")
    if version != CONTRACT_VERSION:
        raise UnsupportedVersionError(version=version)

    try:
        return model.model_validate(raw)
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
    """Publishes one `MeasurementCommandV1` to `streams:measurements`; returns whether it
    was published, and never raises."""

    async def publish(self, command: MeasurementCommandV1) -> bool: ...


class DebitPublisher(Protocol):
    """Publishes one `DebitCommandV1` to `streams:debits`; returns whether it was
    published, and never raises."""

    async def publish(self, command: DebitCommandV1) -> bool: ...
