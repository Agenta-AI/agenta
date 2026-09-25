"""MeasurementWorker.process_batch — organization resolution, malformed/
unsupported-version terminal dead letter, pending retry on publish failure, and
per-message ACK ordering within a batch. No Postgres: all ports are in-memory
fakes, Redis is fakeredis."""

import zlib
from uuid import uuid4

import fakeredis.aioredis as fakeredis
import pytest
from orjson import dumps

from ee.src.core.wallets.contracts import DebitKind
from ee.src.core.wallets.streaming import (
    serialize_debit_command,
    serialize_measurement_command,
)
from ee.src.tasks.asyncio.measurements import worker as worker_module
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
        redis_client=fakeredis.FakeRedis(),
    )


async def _dead_letters(worker: MeasurementWorker):
    return await worker.redis.xrange(worker.dead_letter_stream)


def _entry(command, msg_id: bytes = b"1-0"):
    return (msg_id, {b"data": serialize_measurement_command(command)})


@pytest.mark.asyncio
async def test_happy_path_persists_and_publishes_then_acks():
    org_id = uuid4()
    command = build_measurement_command(organization_id=org_id, endpoint_kind="builtin")
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
        organization_id=None, project_id=project_id, endpoint_kind="builtin"
    )
    resolver = InMemoryOrganizationResolver(mapping={project_id: org_id})
    publisher = InMemoryDebitPublisher()
    worker = _make_worker(resolver=resolver, publisher=publisher)

    _, processed_ids = await worker.process_batch([_entry(command)])

    assert processed_ids == [b"1-0"]
    assert publisher.published[0].organization_id == org_id


@pytest.mark.asyncio
async def test_unresolvable_organization_stores_nothing_and_dead_letters_the_message():
    """A measurement stored without its charge would be replayed as free forever, so
    nothing is stored; the dead letter keeps the whole message for a replay once the
    project resolves."""
    command = build_measurement_command(organization_id=None, endpoint_kind="builtin")
    resolver = InMemoryOrganizationResolver(mapping={})  # never resolves
    publisher = InMemoryDebitPublisher()
    dao = InMemoryMeasurementsDAO()
    worker = _make_worker(dao=dao, resolver=resolver, publisher=publisher)

    _, processed_ids = await worker.process_batch([_entry(command)])

    assert processed_ids == []
    assert command.measurement_id not in dao.rows
    assert publisher.published == []
    [(_, dead)] = await _dead_letters(worker)
    assert b"resolves to no organization" in dead[b"dead_letter_reason"]
    assert dead[b"dead_letter_description"] == command.measurement_id.encode()


class _RaisingResolver:
    async def resolve_organization_id(self, *, project_id):
        raise RuntimeError("core database unavailable")


def _pricer_raises(**_kwargs):
    raise RuntimeError("the pricer must not run for a stored measurement")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "first_publish_fails", [True, False], ids=["after-failed-publish", "after-publish"]
)
async def test_a_redelivery_republishes_the_stored_decision_byte_for_byte(
    monkeypatch, first_publish_fails
):
    """Codex #4 and #8: once a measurement is stored, its charge is replayed from the
    stored decision alone. The resolver and the pricer are not consulted (both raise
    here), and the debit envelope, `created_at` included, is identical to the first."""
    project_id = uuid4()
    command = build_measurement_command(
        organization_id=None, project_id=project_id, endpoint_kind="builtin"
    )
    dao = InMemoryMeasurementsDAO()
    publisher = InMemoryDebitPublisher()
    publisher.fail_next = first_publish_fails
    worker = _make_worker(
        dao=dao,
        resolver=InMemoryOrganizationResolver(mapping={project_id: uuid4()}),
        publisher=publisher,
    )
    await worker.process_batch([_entry(command)])

    worker.organization_resolver = _RaisingResolver()
    monkeypatch.setattr(worker_module, "calculate_charge", _pricer_raises)
    _, processed_ids = await worker.process_batch([_entry(command)])

    assert processed_ids == [b"1-0"]
    first, replayed = publisher.attempts
    assert serialize_debit_command(replayed) == serialize_debit_command(first)
    assert len(dao.rows) == 1


@pytest.mark.asyncio
async def test_a_redelivery_after_a_price_change_keeps_the_stored_price(monkeypatch):
    command = build_measurement_command(endpoint_kind="builtin")
    publisher = InMemoryDebitPublisher()
    publisher.fail_next = True
    worker = _make_worker(publisher=publisher)
    await worker.process_batch([_entry(command)])
    [first] = publisher.attempts

    monkeypatch.setattr(
        worker_module,
        "calculate_charge",
        lambda **_kwargs: (first.amount_musd * 10, "a-later-card"),
    )
    await worker.process_batch([_entry(command)])

    [replayed] = publisher.published
    assert replayed.amount_musd == first.amount_musd
    assert replayed.pricing_version == first.pricing_version


@pytest.mark.asyncio
async def test_not_charged_result_publishes_no_debit():
    command = build_measurement_command(endpoint_kind="custom")
    publisher = InMemoryDebitPublisher()
    worker = _make_worker(publisher=publisher)

    _, processed_ids = await worker.process_batch([_entry(command)])

    assert processed_ids == [b"1-0"]
    assert publisher.published == []


@pytest.mark.asyncio
async def test_malformed_envelope_is_dead_lettered():
    dao = InMemoryMeasurementsDAO()
    publisher = InMemoryDebitPublisher()
    worker = _make_worker(dao=dao, publisher=publisher)
    entry = (b"1-0", {b"data": b"this is not a valid compressed envelope"})

    count, processed_ids = await worker.process_batch([entry])

    assert count == 0
    assert processed_ids == []
    assert dao.insert_calls == []
    assert publisher.published == []
    assert len(await _dead_letters(worker)) == 1


@pytest.mark.asyncio
async def test_unsupported_version_is_dead_lettered():
    dao = InMemoryMeasurementsDAO()
    worker = _make_worker(dao=dao)
    raw = build_measurement_command().model_dump(mode="json")
    raw["version"] = 999
    payload = zlib.compress(dumps(raw))
    entry = (b"1-0", {b"data": payload})

    count, processed_ids = await worker.process_batch([entry])

    assert count == 0
    assert processed_ids == []
    assert dao.insert_calls == []
    [(_, dead)] = await _dead_letters(worker)
    assert dead[b"data"] == payload


@pytest.mark.asyncio
async def test_debit_publish_failure_leaves_message_pending_then_converges_on_retry():
    """Transient Redis failure on the debit publish must not be ACKed. On
    redelivery of the SAME message, the measurement insert is a safe no-op
    (idempotent) and the retried publish succeeds — exactly one measurement
    row and exactly one published debit command, never zero and never two."""
    command = build_measurement_command(endpoint_kind="builtin")
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
    pending_command = build_measurement_command(endpoint_kind="builtin")
    good_command = build_measurement_command(endpoint_kind="builtin")
    dao = InMemoryMeasurementsDAO()
    publisher = InMemoryDebitPublisher()
    worker = _make_worker(dao=dao, publisher=publisher)

    # fail_next consumes on the FIRST actual publish call, which is 1-1's
    # (1-0 is terminal and never reaches the publisher).
    publisher.fail_next = True
    batch = [
        (b"1-0", {b"data": b"not a valid envelope"}),  # terminal — dead-lettered
        _entry(pending_command, msg_id=b"1-1"),  # publish fails — pending
        _entry(good_command, msg_id=b"1-2"),  # publish succeeds — acked
    ]

    count, processed_ids = await worker.process_batch(batch)

    assert count == 1
    assert processed_ids == [b"1-2"]
    assert len(await _dead_letters(worker)) == 1


@pytest.mark.asyncio
async def test_duplicate_component_keys_are_dead_lettered_not_priced():
    """Codex #3: stored values are unique per key while pricing sums every component,
    so `request_count=1` plus `request_count=2` used to charge 150 musd for a
    measurement that stores one count."""
    raw = build_measurement_command(
        gateway_kind="mcp", endpoint_kind="builtin"
    ).model_dump(mode="json")
    raw["components"] = [
        {"key": "request_count", "value": 1, "cost_musd": None},
        {"key": "request_count", "value": 2, "cost_musd": None},
    ]
    dao = InMemoryMeasurementsDAO()
    publisher = InMemoryDebitPublisher()
    worker = _make_worker(dao=dao, publisher=publisher)

    _, processed_ids = await worker.process_batch(
        [(b"1-0", {b"data": zlib.compress(dumps(raw))})]
    )

    assert processed_ids == []
    assert dao.insert_calls == []
    assert publisher.attempts == []
    [(_, dead)] = await _dead_letters(worker)
    assert b"duplicate component keys" in dead[b"dead_letter_reason"]


@pytest.mark.asyncio
async def test_conflicting_replay_is_dead_lettered_and_not_priced():
    """Codex #5: a measurement id seen again with different content must not add
    components to the stored measurement or charge the new payload."""
    original = build_measurement_command(endpoint_kind="builtin")
    conflicting = original.model_copy(
        update={"resource_key": original.resource_key + "-changed"}
    )
    dao = InMemoryMeasurementsDAO()
    publisher = InMemoryDebitPublisher()
    worker = _make_worker(dao=dao, publisher=publisher)

    _, first = await worker.process_batch([_entry(original, msg_id=b"1-0")])
    _, second = await worker.process_batch([_entry(conflicting, msg_id=b"1-1")])

    assert first == [b"1-0"]
    assert second == []
    assert len(publisher.published) == 1  # only the original was charged
    [(_, dead)] = await _dead_letters(worker)
    assert dead[b"dead_letter_source_id"] == b"1-1"
    assert b"different payload" in dead[b"dead_letter_reason"]
