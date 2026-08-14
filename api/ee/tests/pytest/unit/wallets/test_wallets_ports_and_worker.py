from unittest.mock import MagicMock

import pytest

from ee.src.core.wallets.interfaces import WalletCheckPort, WalletSettlementPort
from ee.src.core.wallets.runtime import get_wallet_settlement_port
from ee.src.tasks.asyncio.wallets.worker import DebitWorker
from ee.tests.pytest.utils.wallets.builders import build_debit_command


def test_wallet_check_port_body_raises_not_implemented():
    port = WalletCheckPort()
    with pytest.raises(NotImplementedError):
        port.check(organization_id=None, amount_musd=100)


@pytest.mark.asyncio
async def test_wallet_settlement_port_body_raises_not_implemented():
    port = WalletSettlementPort()
    with pytest.raises(NotImplementedError):
        await port.settle(build_debit_command())


def test_settlement_port_factory_returns_a_settlement_port():
    # WP-1-01 implements this factory; WP-1-00 only seeded it as unimplemented.
    port = get_wallet_settlement_port()
    assert isinstance(port, WalletSettlementPort)
    assert get_wallet_settlement_port() is port  # process-wide singleton


def test_debit_worker_is_constructible():
    worker = DebitWorker(
        settlement_port=WalletSettlementPort(),
        redis_client=MagicMock(),
    )
    assert worker.stream_name == "streams:debits"


@pytest.mark.asyncio
async def test_debit_worker_process_batch_on_empty_batch_is_a_noop():
    # WP-1-03 implements the processing body; see test_wallets_debit_worker.py for the
    # full deserialize/settle/ACK behaviour.
    worker = DebitWorker(
        settlement_port=WalletSettlementPort(),
        redis_client=MagicMock(),
    )
    count, processed_ids = await worker.process_batch([])
    assert count == 0
    assert processed_ids == []
