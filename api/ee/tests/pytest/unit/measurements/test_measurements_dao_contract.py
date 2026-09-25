"""Unit-level DAO contract: unique-measurement replay and parent/value
atomicity, exercised against the in-memory fake (no Postgres). The real
Postgres adapter's own transactional atomicity is covered by the integration
suite against a live tracing DB."""

import pytest

from ee.src.core.wallets.errors import MeasurementConflictError
from ee.tests.pytest.utils.measurements.fakes import InMemoryMeasurementsDAO
from ee.tests.pytest.utils.wallets.builders import build_measurement_command


@pytest.mark.asyncio
async def test_replaying_the_same_measurement_id_does_not_duplicate_the_row():
    dao = InMemoryMeasurementsDAO()
    command = build_measurement_command()

    first = await dao.insert_measurement(command=command)
    second = await dao.insert_measurement(command=command)

    assert first.created is True
    assert second.created is False
    assert first.id == second.id
    assert len(dao.rows) == 1


@pytest.mark.asyncio
async def test_one_insert_call_carries_the_parent_and_all_of_its_values():
    """Atomicity is a property of the call signature: one `insert_measurement`
    call receives the full command (parent header + every component), so the
    real adapter can write both inside a single transaction — never one round
    trip per metric."""
    dao = InMemoryMeasurementsDAO()
    command = build_measurement_command()
    assert len(command.components) >= 1

    persisted = await dao.insert_measurement(command=command)

    assert len(dao.insert_calls) == 1
    assert dao.insert_calls[0] is command
    stored_values = dao.values[persisted.id]
    assert set(stored_values) == {c.key for c in command.components}


@pytest.mark.asyncio
async def test_replay_does_not_re_derive_component_values():
    dao = InMemoryMeasurementsDAO()
    command = build_measurement_command()

    persisted = await dao.insert_measurement(command=command)
    await dao.insert_measurement(command=command)

    # Still exactly one value row per component key — no duplicate rows from
    # the second, redelivered attempt.
    assert len(dao.values[persisted.id]) == len(command.components)


@pytest.mark.asyncio
async def test_a_conflicting_replay_raises_and_leaves_the_stored_measurement_alone():
    dao = InMemoryMeasurementsDAO()
    command = build_measurement_command()
    persisted = await dao.insert_measurement(command=command)
    conflicting = command.model_copy(
        update={
            "components": [
                *command.components,
                command.components[0].model_copy(update={"key": "extra_key"}),
            ]
        }
    )

    with pytest.raises(MeasurementConflictError):
        await dao.insert_measurement(command=conflicting)

    assert set(dao.values[persisted.id]) == {c.key for c in command.components}


@pytest.mark.asyncio
async def test_component_order_does_not_make_a_replay_conflict():
    dao = InMemoryMeasurementsDAO()
    command = build_measurement_command()
    command = command.model_copy(
        update={
            "components": [
                *command.components,
                command.components[0].model_copy(update={"key": "another_key"}),
            ]
        }
    )
    await dao.insert_measurement(command=command)

    reordered = command.model_copy(
        update={"components": list(reversed(command.components))}
    )
    assert (await dao.insert_measurement(command=reordered)).created is False
