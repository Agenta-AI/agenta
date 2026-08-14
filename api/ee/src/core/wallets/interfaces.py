"""Wallet check/settlement ports. Both are contracts only in WP-1-00 — every body raises
`NotImplementedError`; a later package supplies the concrete Postgres-backed adapters.
"""

from uuid import UUID

from ee.src.core.wallets.contracts import DebitCommandV1


class WalletCheckPort:
    """A synchronous, non-strict pre-dispatch admission read.

    May reject an organization already at/below its floor. Must never write a debit,
    reservation, hold, or allocation — `check` is a read, and settlement happens later,
    post-hoc, through `WalletSettlementPort.settle`.
    """

    def check(self, *, organization_id: UUID, amount_musd: int) -> bool:
        raise NotImplementedError


class WalletSettlementPort:
    """Post-hoc settlement of one debit posting."""

    async def settle(self, command: DebitCommandV1) -> None:
        """Apply one debit posting.

        One posting may split into several debit rows, whose `debit_key`s derive from its
        opaque key plus actual source (`wallet_credit_id` or explicit `deficit`), never an
        invented sequence.
        """
        raise NotImplementedError
