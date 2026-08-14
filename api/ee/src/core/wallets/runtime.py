"""Settlement-port factory. Deliberately unimplemented in WP-1-00 — a later package wires
the concrete Postgres-backed `WalletSettlementPort` here.
"""

from ee.src.core.wallets.interfaces import WalletSettlementPort


def get_wallet_settlement_port() -> WalletSettlementPort:
    """Return the process-wide `WalletSettlementPort` implementation.

    Unimplemented by design: WP-1-00 seeds the contract; a later worktree wires the
    concrete adapter.
    """
    raise NotImplementedError
