from unittest.mock import MagicMock

import pytest

from ee.src.core.wallets.interfaces import WalletCheckPort, WalletSettlementPort
from ee.src.tasks.asyncio.wallets.worker import DebitWorker
from ee.tests.pytest.utils.wallets.builders import build_debit_command


@pytest.mark.asyncio
async def test_wallet_check_port_body_raises_not_implemented():
    port = WalletCheckPort()
    with pytest.raises(NotImplementedError):
        await port.check(organization_id=None)


@pytest.mark.asyncio
async def test_wallet_settlement_port_body_raises_not_implemented():
    port = WalletSettlementPort()
    with pytest.raises(NotImplementedError):
        await port.settle(build_debit_command())


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
