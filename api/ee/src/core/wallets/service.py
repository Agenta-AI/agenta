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
    LAZY_PROVISION_FLOOR_MUSD,
    allowance_musd_for_plan,
    floor_musd_for_plan,
)
from ee.src.core.wallets.proration import prorate_incoming_allowance
from ee.src.core.wallets.types import (
    PlanChangeResultDTO,
    WalletCreditDTO,
    WalletGeneralBalanceNotFoundError,
    WalletsDAOInterface,
)


class WalletsService(WalletCheckPort, WalletSettlementPort):
    def __init__(self, *, wallets_dao: WalletsDAOInterface):
        self.wallets_dao = wallets_dao

    async def check(self, *, organization_id: UUID) -> bool:
        # Spendable, not the raw general balance: nothing posts an expired credit's
        # remainder out of the general row, so the raw number would admit calls that
        # settlement can only book as deficit (open-designs item 21).
        balance = await self.wallets_dao.get_spendable_balance(
            organization_id=organization_id,
        )

        if balance is None:
            # An organization created while `AGENTA_WALLETS_ENABLED` was off has no
            # general balance row and nothing else will ever give it one: the
            # `ee0000000005` backfill ran once, at migration time. Provision it here, on
            # the first admission read, rather than leaving admission to answer from a
            # row that does not exist — open-designs item 14.
            #
            # This stays within the port's write-free contract in the sense that matters:
            # `check` still writes no debit, reservation, hold or allocation. It writes a
            # zero-balance projection row, idempotently, and then answers from it. That
            # answer is a rejection for an organization with no credits, which is the
            # correct reading of the wallet and the whole reason the missing row was a
            # gap rather than a permission to spend.
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

        # Non-strict: reject only once already-committed balance is at/below the floor.
        return balance.spendable_musd > floor

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
        subscription_id: Optional[str],
        incoming_plan: str,
        period_start: Optional[datetime],
        period_end: Optional[datetime],
        now: datetime,
    ) -> PlanChangeResultDTO:
        """Claw back the outgoing allowance's unused share, mint the incoming plan's
        prorated share, and update the general balance's floor — all as one atomic
        transaction in the DAO, replay-safe on `idempotency_key`. Never mutates an
        existing `wallet_credits` row; never issues the recurring full-period allowance
        (that is a later wave's job).

        `now` is when the change took effect, and `period_start`/`period_end` are the
        billing period the incoming allowance covers, as the billing provider reports
        it. The period's end is also the minted credit's `end_time`, so a credit never
        outlives the period it pays for. A plan without a paid period (the free plan
        after a cancellation) passes none, which is only valid when it carries no
        allowance.

        The outgoing side needs no plan and no period from the caller: the DAO reads
        both off the outgoing credit itself, under the same lock as the writes."""
        incoming_allowance_musd = allowance_musd_for_plan(plan=incoming_plan)

        incoming_credit_amount_musd = 0
        if incoming_allowance_musd > 0:
            if period_start is None or period_end is None:
                raise ValueError(
                    f"Plan [{incoming_plan}] carries an allowance but no billing "
                    "period was given to prorate it over"
                )
            incoming_credit_amount_musd = prorate_incoming_allowance(
                allowance_musd=incoming_allowance_musd,
                period_start=period_start,
                period_end=period_end,
                now=now,
            )

        return await self.wallets_dao.apply_plan_change(
            organization_id=organization_id,
            idempotency_key=idempotency_key,
            subscription_id=subscription_id,
            incoming_credit_amount_musd=incoming_credit_amount_musd,
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
