"""Settlement-port factory. WP-1-00 seeded this unimplemented; WP-1-01 wires the concrete
Postgres-backed adapter — the transaction behind `WalletCheckPort`/`WalletSettlementPort`.
Consuming this port (e.g. `DebitWorker.process_batch`) remains a later package's job.
"""

from typing import Optional

from ee.src.core.wallets.interfaces import WalletSettlementPort
from ee.src.core.wallets.service import WalletsService
from ee.src.dbs.postgres.wallets.dao import WalletsDAO

_wallet_settlement_port: Optional[WalletSettlementPort] = None


def get_wallet_settlement_port() -> WalletSettlementPort:
    """Return the process-wide `WalletSettlementPort` implementation."""
    global _wallet_settlement_port

    if _wallet_settlement_port is None:
        _wallet_settlement_port = WalletsService(wallets_dao=WalletsDAO())

    return _wallet_settlement_port
