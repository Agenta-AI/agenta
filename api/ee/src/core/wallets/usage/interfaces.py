"""Read ports for the wallet usage view. The core DB holds the ledger and the names; the
tracing DB holds the measurements the debits were priced from."""

from datetime import datetime
from typing import Dict, Iterable, List, Tuple
from uuid import UUID

from ee.src.core.wallets.usage.dtos import (
    MeasurementUsage,
    WalletCreditUsage,
    WalletUsageDebit,
)


class WalletUsageDAOInterface:
    async def list_credits(self, *, organization_id: UUID) -> List[WalletCreditUsage]:
        raise NotImplementedError

    async def list_usage_debits(
        self,
        *,
        organization_id: UUID,
        start: datetime,
        end: datetime,
        limit: int,
    ) -> List[WalletUsageDebit]:
        """Gateway-usage postings in `[start, end)`, newest first, one per idempotency
        key, at most `limit`."""
        raise NotImplementedError

    async def user_emails(self, *, user_ids: Iterable[UUID]) -> Dict[UUID, str]:
        raise NotImplementedError

    async def agent_names(
        self, *, agents: Iterable[Tuple[UUID, UUID]]
    ) -> Dict[Tuple[UUID, UUID], str]:
        """Names keyed by `(project_id, agent_id)`; an agent outside its pair's project
        has no name here."""
        raise NotImplementedError


class MeasurementUsageDAOInterface:
    async def fetch_measurements(
        self, *, measurement_ids: Iterable[str]
    ) -> Dict[str, MeasurementUsage]:
        raise NotImplementedError
