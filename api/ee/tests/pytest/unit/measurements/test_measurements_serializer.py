"""Serializer round-trip use for measurement/debit commands built by the
wallet-owned fakes — no Redis, no Postgres."""

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


def test_measurement_command_round_trips_through_serializer():
    command = build_measurement_command()

    payload = serialize_measurement_command(command)
    restored = deserialize_measurement_command(payload)

    assert restored == command


def test_debit_command_round_trips_through_serializer():
    command = build_debit_command()

    payload = serialize_debit_command(command)
    restored = deserialize_debit_command(payload)

    assert restored == command


def test_measurement_command_with_no_components_round_trips():
    command = build_measurement_command(components=[])

    restored = deserialize_measurement_command(serialize_measurement_command(command))

    assert restored.components == []
