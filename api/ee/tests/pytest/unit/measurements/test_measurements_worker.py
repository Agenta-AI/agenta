"""MeasurementWorker.process_batch — organization resolution, malformed/
unsupported-version terminal ACK, pending retry on publish failure, and
per-message ACK ordering within a batch. No Redis/Postgres: all ports are
in-memory fakes."""

import zlib
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from orjson import dumps

from ee.src.core.wallets.contracts import DebitKind
from ee.src.core.wallets.streaming import serialize_measurement_command
from ee.src.tasks.asyncio.measurements.worker import MeasurementWorker
from ee.tests.pytest.utils.measurements.fakes import (
    InMemoryDebitPublisher,
    InMemoryMeasurementsDAO,
    InMemoryOrganizationResolver,
)
from ee.tests.pytest.utils.wallets.builders import build_measurement_command


def _make_worker(*, dao=None, resolver=None, publisher=None) -> MeasurementWorker:
    return MeasurementWorker(
        measurements_dao=dao or InMemoryMeasurementsDAO(),
        organization_resolver=resolver or InMemoryOrganizationResolver(),
        debit_publisher=publisher or InMemoryDebitPublisher(),
        redis_client=MagicMock(),
    )


def _entry(command, msg_id: bytes = b"1-0"):
    return (msg_id, {b"data": serialize_measurement_command(command)})


@pytest.mark.asyncio
async def test_happy_path_persists_and_publishes_then_acks():
    org_id = uuid4()
    command = build_measurement_command(organization_id=org_id, endpoint_kind="managed")
    dao = InMemoryMeasurementsDAO()
    publisher = InMemoryDebitPublisher()
    worker = _make_worker(dao=dao, publisher=publisher)

    count, processed_ids = await worker.process_batch([_entry(command)])

    assert count == 1
    assert processed_ids == [b"1-0"]
    assert command.measurement_id in dao.rows
    assert len(publisher.published) == 1
    debit = publisher.published[0]
    assert debit.organization_id == org_id
    assert debit.debit_kind == DebitKind.GATEWAY_USAGE
    assert debit.amount_musd > 0
    assert debit.idempotency_key == f"measurement:{command.measurement_id}"


@pytest.mark.asyncio
async def test_resolves_organization_from_project_when_envelope_omits_it():
    project_id = uuid4()
    org_id = uuid4()
    command = build_measurement_command(
        organization_id=None, project_id=project_id, endpoint_kind="managed"
    )
    resolver = InMemoryOrganizationResolver(mapping={project_id: org_id})
    publisher = InMemoryDebitPublisher()
    worker = _make_worker(resolver=resolver, publisher=publisher)

    _, processed_ids = await worker.process_batch([_entry(command)])

    assert processed_ids == [b"1-0"]
    assert publisher.published[0].organization_id == org_id


@pytest.mark.asyncio
async def test_unresolvable_organization_still_acks_but_publishes_no_debit():
    command = build_measurement_command(organization_id=None, endpoint_kind="managed")
    resolver = InMemoryOrganizationResolver(mapping={})  # never resolves
    publisher = InMemoryDebitPublisher()
    dao = InMemoryMeasurementsDAO()
    worker = _make_worker(dao=dao, resolver=resolver, publisher=publisher)

    _, processed_ids = await worker.process_batch([_entry(command)])

    assert processed_ids == [b"1-0"]  # measurement persisted, so safe to ack
    assert command.measurement_id in dao.rows
    assert publisher.published == []


@pytest.mark.asyncio
async def test_not_charged_result_publishes_no_debit():
    command = build_measurement_command(endpoint_kind="custom")
    publisher = InMemoryDebitPublisher()
    worker = _make_worker(publisher=publisher)

    _, processed_ids = await worker.process_batch([_entry(command)])

    assert processed_ids == [b"1-0"]
    assert publisher.published == []


@pytest.mark.asyncio
async def test_malformed_envelope_is_terminally_acked():
    dao = InMemoryMeasurementsDAO()
    publisher = InMemoryDebitPublisher()
    worker = _make_worker(dao=dao, publisher=publisher)
    entry = (b"1-0", {b"data": b"this is not a valid compressed envelope"})

    count, processed_ids = await worker.process_batch([entry])

    assert count == 1
    assert processed_ids == [b"1-0"]
    assert dao.insert_calls == []
    assert publisher.published == []


@pytest.mark.asyncio
async def test_unsupported_version_is_terminally_acked():
    dao = InMemoryMeasurementsDAO()
    worker = _make_worker(dao=dao)
    raw = build_measurement_command().model_dump(mode="json")
    raw["version"] = 999
    payload = zlib.compress(dumps(raw))
    entry = (b"1-0", {b"data": payload})

    count, processed_ids = await worker.process_batch([entry])

    assert count == 1
    assert processed_ids == [b"1-0"]
    assert dao.insert_calls == []


@pytest.mark.asyncio
async def test_debit_publish_failure_leaves_message_pending_then_converges_on_retry():
    """Transient Redis failure on the debit publish must not be ACKed. On
    redelivery of the SAME message, the measurement insert is a safe no-op
    (idempotent) and the retried publish succeeds — exactly one measurement
    row and exactly one published debit command, never zero and never two."""
    command = build_measurement_command(endpoint_kind="managed")
    dao = InMemoryMeasurementsDAO()
    publisher = InMemoryDebitPublisher()
    publisher.fail_next = True
    worker = _make_worker(dao=dao, publisher=publisher)
    batch = [_entry(command)]

    count_1, processed_1 = await worker.process_batch(batch)
    assert count_1 == 0
    assert processed_1 == []  # left pending
    assert len(dao.rows) == 1  # tracing write already succeeded
    assert publisher.published == []

    count_2, processed_2 = await worker.process_batch(batch)  # redelivery
    assert count_2 == 1
    assert processed_2 == [b"1-0"]
    assert len(dao.rows) == 1  # still one measurement — idempotent replay
    assert len(publisher.published) == 1  # exactly one debit command


@pytest.mark.asyncio
async def test_ack_ordering_is_per_message_within_a_batch():
    """One bad message in a batch must not block the others: each message's
    ACK decision is independent."""
    pending_command = build_measurement_command(endpoint_kind="managed")
    good_command = build_measurement_command(endpoint_kind="managed")
    dao = InMemoryMeasurementsDAO()
    publisher = InMemoryDebitPublisher()
    worker = _make_worker(dao=dao, publisher=publisher)

    # fail_next consumes on the FIRST actual publish call, which is 1-1's
    # (1-0 is terminal and never reaches the publisher).
    publisher.fail_next = True
    batch = [
        (b"1-0", {b"data": b"not a valid envelope"}),  # terminal — acked
        _entry(pending_command, msg_id=b"1-1"),  # publish fails — pending
        _entry(good_command, msg_id=b"1-2"),  # publish succeeds — acked
    ]

    count, processed_ids = await worker.process_batch(batch)

    assert count == 2
    assert processed_ids == [b"1-0", b"1-2"]
    assert b"1-1" not in processed_ids
