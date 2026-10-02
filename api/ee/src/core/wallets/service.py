"""Concrete adapter for `WalletCheckPort` and `WalletSettlementPort`.

`check` (write-free, non-strict admission read) and `settle` (atomic debit posting) answer
different questions — see `docs/design/wallets-research/v1/entities.md` §"Metering and
billing boundary". Neither calls `check_entitlements`
(`ee.src.core.access.entitlements.service`); that checks a meter against a plan limit, this
checks the wallet's committed balance against its floor.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from uuid import UUID

from ee.src.core.wallets.contracts import DebitCommandV1
from ee.src.core.wallets.grants import (
    GrantReferenceRequiredError,
    UnknownGrantActivityError,
    compose_award_idempotency_key,
    get_grant_rule,
)
from ee.src.core.wallets.interfaces import WalletCheckPort, WalletSettlementPort
from ee.src.core.wallets.plans import (
    LAZY_PROVISION_FLOOR_MUSD,
    floor_musd_for_plan,
)
from ee.src.core.wallets.types import (
    WalletCreditDTO,
    WalletGeneralBalanceNotFoundError,
    WalletsDAOInterface,
)


class WalletsService(WalletCheckPort, WalletSettlementPort):
    def __init__(self, *, wallets_dao: WalletsDAOInterface):
        self.wallets_dao = wallets_dao

    async def check(self, *, organization_id: UUID) -> bool:
        balance, floor = await self._spendable(organization_id=organization_id)
        # Non-strict: reject only once already-committed balance is at/below the floor.
        return balance > floor

    async def covers(self, *, organization_id: UUID, amount_musd: int) -> bool:
        """Whether the organization can pay `amount_musd` and stay at or above its floor.

        A threshold, not a hold: nothing is reserved, so concurrent calls can each pass it.
        Used where a call's worst-case price is known before dispatch (a managed tool
        action). Not on `WalletCheckPort`, whose contract keeps an amount out until a
        reserving check exists."""
        if amount_musd < 0:
            raise ValueError("amount_musd must not be negative")
        balance, floor = await self._spendable(organization_id=organization_id)
        return balance > floor and balance - amount_musd >= floor

    async def _spendable(self, *, organization_id: UUID) -> Tuple[int, int]:
        # Spendable, not the raw general balance: nothing posts an expired credit's
        # remainder out of the general row, so the raw number would admit calls that
        # settlement can only book as deficit (open-designs item 21).
        balance = await self.wallets_dao.get_spendable_balance(
            organization_id=organization_id,
        )

        if balance is None:
            # Some organizations have no row (created while the flag was off, or by a
            # path that skips provisioning). Writing an empty projection row keeps the
            # port's contract: no debit, reservation, hold or allocation. Open-designs
            # item 14.
            await self.wallets_dao.provision_general_balance(
                organization_id=organization_id,
                floor_musd=LAZY_PROVISION_FLOOR_MUSD,
            )
            # Re-read rather than trusting the fresh row: a concurrent award may have
            # provisioned it first and funded it.
            balance = await self.wallets_dao.get_spendable_balance(
                organization_id=organization_id,
            )
            if balance is None:
                raise WalletGeneralBalanceNotFoundError(organization_id)

        floor = balance.floor_musd if balance.floor_musd is not None else 0
        return balance.spendable_musd, floor

    async def settle(self, command: DebitCommandV1) -> None:
        await self.wallets_dao.settle(command=command)

    async def provision_general_balance(
        self,
        *,
        organization_id: UUID,
        plan: str,
    ) -> None:
        """Idempotent — see `WalletsDAOInterface.provision_general_balance`. Called from
        the organization-creation flow, after the organization-creation transaction has
        already committed."""
        await self.wallets_dao.provision_general_balance(
            organization_id=organization_id,
            floor_musd=floor_musd_for_plan(plan=plan),
        )

    async def award(
        self,
        *,
        organization_id: UUID,
        activity_code: str,
        reference: Optional[str] = None,
        now: Optional[datetime] = None,
    ) -> WalletCreditDTO:
        """Idempotently award a `ee.src.core.wallets.grants.GRANT_CATALOG` activity.
        Returns the newly minted credit, or the existing one on a repeat call — never
        raises on a repeat, never double-awards. See
        `WalletsDAOInterface.award_credit` for the transaction shape."""
        rule = get_grant_rule(activity_code=activity_code)
        if rule is None:
            raise UnknownGrantActivityError(activity_code)

        if rule.repeatable and reference is None:
            raise GrantReferenceRequiredError(activity_code)

        now = now or datetime.now(timezone.utc)
        idempotency_key = compose_award_idempotency_key(
            activity_code=activity_code,
            organization_id=organization_id,
            reference=reference if rule.repeatable else None,
        )
        end_time = (
            now + timedelta(days=rule.lifetime_days)
            if rule.lifetime_days is not None
            else None
        )

        return await self.wallets_dao.award_credit(
            organization_id=organization_id,
            idempotency_key=idempotency_key,
            credit_kind=rule.credit_kind,
            amount_musd=rule.amount_musd,
            priority=rule.priority,
            end_time=end_time,
            now=now,
        )
