"""DebitWorker.process_batch — valid dispatch, duplicate delivery, malformed/
unsupported-version terminal ACK, retryable settlement failure, and per-message
ACK ordering. No Redis/Postgres: settlement is an in-memory fake port."""

import zlib
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from orjson import dumps

from ee.src.core.wallets.errors import SettlementUnavailableError
from ee.src.core.wallets.streaming import serialize_debit_command
from ee.src.tasks.asyncio.wallets.worker import DebitWorker
from ee.tests.pytest.utils.wallets.builders import build_debit_command
from ee.tests.pytest.utils.wallets.fakes import FakeWalletSettlementPort


def _make_worker(*, settlement_port=None) -> DebitWorker:
    return DebitWorker(
        settlement_port=settlement_port or FakeWalletSettlementPort(),
        redis_client=MagicMock(),
    )


def _entry(command, msg_id: bytes = b"1-0"):
    return (msg_id, {b"data": serialize_debit_command(command)})


@pytest.mark.asyncio
async def test_valid_dispatch_calls_settle_exactly_once_with_key_unmodified():
    org_id = uuid4()
    command = build_debit_command(
        organization_id=org_id, idempotency_key="gw_original_key_unchanged"
    )
    port = FakeWalletSettlementPort()
    worker = _make_worker(settlement_port=port)

    count, processed_ids = await worker.process_batch([_entry(command)])

    assert count == 1
    assert processed_ids == [b"1-0"]
    assert len(port.calls) == 1
    assert port.calls[0].idempotency_key == "gw_original_key_unchanged"
    assert port.calls[0] == command  # round-tripped through the wire, not mutated


@pytest.mark.asyncio
async def test_duplicate_delivery_leaves_effects_unchanged_and_still_acks():
    command = build_debit_command(idempotency_key="gw_dup_key")
    port = FakeWalletSettlementPort()
    worker = _make_worker(settlement_port=port)

    count_1, processed_1 = await worker.process_batch([_entry(command, msg_id=b"1-0")])
    count_2, processed_2 = await worker.process_batch([_entry(command, msg_id=b"1-1")])

    assert count_1 == 1
    assert processed_1 == [b"1-0"]
    assert count_2 == 1
    assert processed_2 == [b"1-1"]  # duplicate delivery still ACKs
    assert len(port.calls) == 2  # settle() invoked both times...
    key = (command.organization_id, command.idempotency_key)
    assert port.effects[key] == 1  # ...but only one financial effect


@pytest.mark.asyncio
async def test_malformed_envelope_acks_without_calling_settle():
    port = FakeWalletSettlementPort()
    worker = _make_worker(settlement_port=port)
    entry = (b"1-0", {b"data": b"this is not a valid compressed envelope"})

    count, processed_ids = await worker.process_batch([entry])

    assert count == 1
    assert processed_ids == [b"1-0"]
    assert port.calls == []


@pytest.mark.asyncio
async def test_unknown_version_acks_without_calling_settle():
    port = FakeWalletSettlementPort()
    worker = _make_worker(settlement_port=port)
    raw = build_debit_command().model_dump(mode="json")
    raw["version"] = 999
    payload = zlib.compress(dumps(raw))
    entry = (b"1-0", {b"data": payload})

    count, processed_ids = await worker.process_batch([entry])

    assert count == 1
    assert processed_ids == [b"1-0"]
    assert port.calls == []


@pytest.mark.asyncio
async def test_transient_settlement_failure_does_not_ack():
    command = build_debit_command()
    port = FakeWalletSettlementPort()
    port.raise_next = SettlementUnavailableError("db unavailable")
    worker = _make_worker(settlement_port=port)

    count, processed_ids = await worker.process_batch([_entry(command)])

    assert count == 0
    assert processed_ids == []  # left pending, not ACKed
    assert len(port.calls) == 1  # settle() was attempted


@pytest.mark.asyncio
async def test_transient_failure_then_redelivery_converges_to_one_effect():
    command = build_debit_command(idempotency_key="gw_retry_converges")
    port = FakeWalletSettlementPort()
    port.raise_next = SettlementUnavailableError("db unavailable")
    worker = _make_worker(settlement_port=port)
    batch = [_entry(command)]

    count_1, processed_1 = await worker.process_batch(batch)
    assert count_1 == 0
    assert processed_1 == []

    count_2, processed_2 = await worker.process_batch(batch)  # redelivery
    assert count_2 == 1
    assert processed_2 == [b"1-0"]

    key = (command.organization_id, command.idempotency_key)
    assert port.effects[key] == 1


@pytest.mark.asyncio
async def test_ack_ordering_strictly_follows_committed_transaction():
    """ACK order must reflect settlement outcome per message, not batch position: a
    failing settle() must never ACK, a successful one always must, independent of
    surrounding messages in the same batch."""
    failing_command = build_debit_command(idempotency_key="gw_fails")
    ok_command = build_debit_command(idempotency_key="gw_ok")
    port = FakeWalletSettlementPort()
    worker = _make_worker(settlement_port=port)

    real_settle = port.settle
    calls_seen = []

    async def _settle_recording(command):
        calls_seen.append(command.idempotency_key)
        if command.idempotency_key == "gw_fails":
            raise SettlementUnavailableError("db unavailable")
        return await real_settle(command)

    port.settle = _settle_recording

    batch = [
        _entry(failing_command, msg_id=b"1-0"),
        _entry(ok_command, msg_id=b"1-1"),
    ]

    count, processed_ids = await worker.process_batch(batch)

    assert count == 1
    assert processed_ids == [
        b"1-1"
    ]  # only the message whose settle() committed is ACKed
    assert b"1-0" not in processed_ids
    assert calls_seen == ["gw_fails", "gw_ok"]  # settle() was still attempted for both


@pytest.mark.asyncio
async def test_worker_derives_no_amount_price_or_debit_key():
    """The worker's only domain call is settle(command); it must not read/derive
    amount_musd, pricing_version, or debit_key itself. Assert via source inspection of the
    class body (not the module docstring, which discusses these concerns in prose) that
    none of these fields is ever read off the command or computed locally."""
    import inspect

    from ee.src.tasks.asyncio.wallets.worker import DebitWorker

    source = inspect.getsource(DebitWorker)
    assert "amount_musd" not in source
    assert "pricing_version" not in source
    assert "debit_key" not in source
    assert "plan_settlement" not in source
