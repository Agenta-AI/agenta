import uuid

import pytest

try:
    from asyncpg.pgproto.pgproto import UUID as AsyncpgUUID
except ImportError:
    AsyncpgUUID = None

from ee.src.core.wallets.errors import MalformedEnvelopeError, UnsupportedVersionError
from ee.src.core.wallets.streaming import (
    deserialize_debit_command,
    deserialize_measurement_command,
    serialize_debit_command,
    serialize_measurement_command,
)
from ee.tests.pytest.utils.wallets.builders import (
    build_debit_command,
    build_measurement_command,
)


def test_measurement_command_round_trips_through_serialization():
    command = build_measurement_command()

    payload = serialize_measurement_command(command)
    assert isinstance(payload, bytes)

    restored = deserialize_measurement_command(payload)
    assert restored == command


def test_debit_command_round_trips_through_serialization():
    command = build_debit_command()

    payload = serialize_debit_command(command)
    assert isinstance(payload, bytes)

    restored = deserialize_debit_command(payload)
    assert restored == command


def test_deserialize_measurement_command_rejects_unsupported_version():
    command = build_measurement_command()
    payload = serialize_measurement_command(command)

    tampered = _with_version(payload, 2)

    with pytest.raises(UnsupportedVersionError):
        deserialize_measurement_command(tampered)


def test_deserialize_debit_command_rejects_unsupported_version():
    command = build_debit_command()
    payload = serialize_debit_command(command)

    tampered = _with_version(payload, 2)

    with pytest.raises(UnsupportedVersionError):
        deserialize_debit_command(tampered)


def test_deserialize_measurement_command_rejects_malformed_payload():
    with pytest.raises(MalformedEnvelopeError):
        deserialize_measurement_command(b"not-a-valid-compressed-payload")


@pytest.mark.skipif(AsyncpgUUID is None, reason="asyncpg not installed")
def test_asyncpg_uuid_serializes_rather_than_raising():
    org_id = AsyncpgUUID(uuid.uuid4().bytes)
    command = build_measurement_command(
        organization_id=org_id,
        resource_locator={"endpoint_id": AsyncpgUUID(uuid.uuid4().bytes)},
    )

    payload = serialize_measurement_command(command)
    restored = deserialize_measurement_command(payload)

    assert str(restored.organization_id) == str(org_id)


def _with_version(payload: bytes, version: int) -> bytes:
    import zlib

    from orjson import dumps, loads

    raw = loads(zlib.decompress(payload))
    raw["version"] = version
    return zlib.compress(dumps(raw))
