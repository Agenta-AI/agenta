"""Concrete adapter for `WalletCheckPort` and `WalletSettlementPort`.

`check` (write-free, non-strict admission read) and `settle` (atomic debit posting) answer
different questions — see `docs/design/wallets-research/v1/entities.md` §"Metering and
billing boundary". Neither calls `check_entitlements`
(`ee.src.core.access.entitlements.service`); that checks a meter against a plan limit, this
checks the wallet's committed balance against its floor.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional
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
    PLAN_ALLOWANCE_CREDIT_KIND,
    PLAN_ALLOWANCE_PRIORITY,
    allowance_musd_for_plan,
    floor_musd_for_plan,
)
from ee.src.core.wallets.proration import compute_plan_change_proration
from ee.src.core.wallets.types import (
    PlanChangeResultDTO,
    WalletCreditDTO,
    WalletsDAOInterface,
)


class WalletsService(WalletCheckPort, WalletSettlementPort):
    def __init__(self, *, wallets_dao: WalletsDAOInterface):
        self.wallets_dao = wallets_dao

    async def check(self, *, organization_id: UUID) -> bool:
        general = await self.wallets_dao.get_general_balance(
            organization_id=organization_id,
        )

        if general is None:
            # No wallet provisioned for this organization: nothing to reject against.
            return True

        floor = general.floor_musd if general.floor_musd is not None else 0

        # Non-strict: reject only once already-committed balance is at/below the floor.
        return general.balance_musd > floor

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

    async def apply_plan_change(
        self,
        *,
        organization_id: UUID,
        idempotency_key: str,
        outgoing_plan: str,
        incoming_plan: str,
        period_start: datetime,
        period_end: datetime,
        now: Optional[datetime] = None,
    ) -> PlanChangeResultDTO:
        """Prorate the outgoing plan's unused allowance out, mint the incoming plan's
        prorated share, and update the general balance's floor — all as one atomic
        transaction in the DAO, replay-safe on `idempotency_key`. Never mutates an
        existing `wallet_credits` row; never issues the recurring full-period allowance
        (that is a later wave's job)."""
        now = now or datetime.now(timezone.utc)

        outgoing_credit = await self.wallets_dao.get_active_plan_allowance_credit(
            organization_id=organization_id,
        )

        proration = compute_plan_change_proration(
            outgoing_credit_id=outgoing_credit.id if outgoing_credit else None,
            outgoing_allowance_musd=allowance_musd_for_plan(plan=outgoing_plan),
            incoming_allowance_musd=allowance_musd_for_plan(plan=incoming_plan),
            period_start=period_start,
            period_end=period_end,
            now=now,
        )

        return await self.wallets_dao.apply_plan_change(
            organization_id=organization_id,
            idempotency_key=idempotency_key,
            outgoing_credit_id=proration.outgoing_credit_id,
            outgoing_debit_amount_musd=proration.outgoing_debit_amount_musd,
            incoming_credit_kind=PLAN_ALLOWANCE_CREDIT_KIND,
            incoming_credit_amount_musd=proration.incoming_credit_amount_musd,
            incoming_priority=PLAN_ALLOWANCE_PRIORITY,
            incoming_end_time=period_end,
            floor_musd=floor_musd_for_plan(plan=incoming_plan),
            now=now,
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
