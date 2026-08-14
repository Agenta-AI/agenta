"""Concrete adapter for `WalletCheckPort` and `WalletSettlementPort`.

`check` (write-free, non-strict admission read) and `settle` (atomic debit posting) answer
different questions — see `docs/design/wallets-research/v1/entities.md` §"Metering and
billing boundary". Neither calls `check_entitlements`
(`ee.src.core.access.entitlements.service`); that checks a meter against a plan limit, this
checks the wallet's committed balance against its floor.
"""

import asyncio
import concurrent.futures
from uuid import UUID

from ee.src.core.wallets.contracts import DebitCommandV1
from ee.src.core.wallets.interfaces import WalletCheckPort, WalletSettlementPort
from ee.src.core.wallets.types import WalletsDAOInterface


def _run_blocking(coro):
    """Run an async coroutine to completion from a sync call site.

    `WalletCheckPort.check` is a synchronous, non-strict pre-dispatch read (see
    `interfaces.py`); the wallet storage is async (asyncpg via `TransactionsEngine`). If no
    event loop is currently running, run the coroutine directly. If one is (an async caller
    invoking this sync method), run it on a dedicated thread with its own loop rather than
    failing with "cannot be called from a running event loop".
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


class WalletsService(WalletCheckPort, WalletSettlementPort):
    def __init__(self, *, wallets_dao: WalletsDAOInterface):
        self.wallets_dao = wallets_dao

    def check(self, *, organization_id: UUID, amount_musd: int) -> bool:
        return _run_blocking(self._check(organization_id=organization_id))

    async def _check(self, *, organization_id: UUID) -> bool:
        general = await self.wallets_dao.get_general_balance(
            organization_id=organization_id,
        )

        if general is None:
            # No wallet provisioned for this organization: nothing to reject against.
            return True

        floor = general.floor_musd if general.floor_musd is not None else 0

        # Non-strict: reject only once already-committed balance is at/below the floor.
        # The request's own amount_musd is deliberately not part of this predicate —
        # variable-cost work is priced after the fact, at settle() time.
        return general.balance_musd > floor

    async def settle(self, command: DebitCommandV1) -> None:
        await self.wallets_dao.settle(command=command)
