"""Concrete adapter for `WalletCheckPort` and `WalletSettlementPort`.

`check` (write-free, non-strict admission read) and `settle` (atomic debit posting) answer
different questions — see `docs/design/wallets-research/v1/entities.md` §"Metering and
billing boundary". Neither calls `check_entitlements`
(`ee.src.core.access.entitlements.service`); that checks a meter against a plan limit, this
checks the wallet's committed balance against its floor.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Awaitable, Callable, Optional, Set, Tuple
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from ee.src.core.wallets.contracts import DebitCommandV1
from ee.src.core.wallets.grants import (
    DAILY_FREE_ACTIVITY,
    GrantReferenceRequiredError,
    UnknownGrantActivityError,
    compose_award_idempotency_key,
    daily_free_reference,
    get_grant_rule,
    next_utc_midnight,
)
from ee.src.core.wallets.interfaces import WalletCheckPort, WalletSettlementPort
from ee.src.core.wallets.plans import (
    DAILY_FREE_CREDIT_PLANS,
    LAZY_PROVISION_FLOOR_MUSD,
    PLAN_ALLOWANCE_CREDIT_KIND,
    PLAN_ALLOWANCE_PRIORITY,
    allowance_musd_for_plan,
    floor_musd_for_plan,
)
from ee.src.core.wallets.purchases import (
    PURCHASE_CREDIT_KIND,
    PURCHASE_LIFETIME_DAYS,
    PURCHASE_PRIORITY,
    STARTER_CREDITS_KIND,
    STARTER_CREDITS_LIFETIME_DAYS,
    STARTER_CREDITS_PRIORITY,
)
from ee.src.core.wallets.types import (
    WalletCreditDTO,
    WalletGeneralBalanceNotFoundError,
    WalletsDAOInterface,
)

log = get_module_logger(__name__)

PlanReader = Callable[[UUID], Awaitable[Optional[str]]]


class WalletsService(WalletCheckPort, WalletSettlementPort):
    def __init__(
        self,
        *,
        wallets_dao: WalletsDAOInterface,
        plan_reader: Optional[PlanReader] = None,
    ):
        self.wallets_dao = wallets_dao
        # Reads an organization's plan slug. Only the admission instance has one, and only
        # that instance grants the daily free credits.
        self.plan_reader = plan_reader
        # Organizations whose daily grant this process already settled for `_daily_day`.
        # Spares a plan read and a locked award on every admission; the award's
        # idempotency key, not this set, is what guarantees one grant per day.
        self._daily_day: Optional[date] = None
        self._daily_done: Set[UUID] = set()

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
        await self._grant_daily_free_credits(organization_id=organization_id)

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

    async def _grant_daily_free_credits(self, *, organization_id: UUID) -> None:
        """Grant today's free credits on the organization's first admission of the UTC
        day, when its plan has them. Never fails the admission: a failed grant is logged
        and retried on the next admission."""
        if self.plan_reader is None:
            return

        now = datetime.now(timezone.utc)
        today = now.date()
        if self._daily_day != today:
            self._daily_day = today
            self._daily_done = set()
        if organization_id in self._daily_done:
            return

        try:
            plan = await self.plan_reader(organization_id)
            if plan in DAILY_FREE_CREDIT_PLANS:
                await self.award(
                    organization_id=organization_id,
                    activity_code=DAILY_FREE_ACTIVITY,
                    reference=daily_free_reference(day=today),
                    now=now,
                )
            self._daily_done.add(organization_id)
        except Exception:
            log.warning(
                "[wallets] daily free credits grant failed; retrying on next admission",
                organization_id=str(organization_id),
                exc_info=True,
            )

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
        if rule.ends_at_utc_midnight:
            end_time = next_utc_midnight(now)
        elif rule.lifetime_days is not None:
            end_time = now + timedelta(days=rule.lifetime_days)
        else:
            end_time = None

        return await self.wallets_dao.award_credit(
            organization_id=organization_id,
            idempotency_key=idempotency_key,
            credit_kind=rule.credit_kind,
            amount_musd=rule.amount_musd,
            priority=rule.priority,
            end_time=end_time,
            now=now,
        )

    async def grant_period_allowance(
        self,
        *,
        organization_id: UUID,
        plan: str,
        period_start: datetime,
        period_end: datetime,
    ) -> Optional[WalletCreditDTO]:
        """Grant a paid plan's monthly credits for one billing period, expiring at its
        end. Idempotent per organization and period start, so a redelivered renewal
        event grants once. Returns None for a plan without monthly credits."""
        amount_musd = allowance_musd_for_plan(plan=plan)
        if amount_musd <= 0:
            return None

        return await self.wallets_dao.award_credit(
            organization_id=organization_id,
            idempotency_key=(
                f"plan_allowance:organization:{organization_id}"
                f":period:{period_start.isoformat()}"
            ),
            credit_kind=PLAN_ALLOWANCE_CREDIT_KIND,
            amount_musd=amount_musd,
            priority=PLAN_ALLOWANCE_PRIORITY,
            end_time=period_end,
            now=period_start,
        )

    async def grant_purchase(
        self,
        *,
        organization_id: UUID,
        checkout_session_id: str,
        amount_musd: int,
        now: Optional[datetime] = None,
    ) -> WalletCreditDTO:
        """Grant a paid top-up, expiring after twelve months. Idempotent per Stripe
        checkout session, so a redelivered payment event grants once."""
        now = now or datetime.now(timezone.utc)
        return await self.wallets_dao.award_credit(
            organization_id=organization_id,
            idempotency_key=f"purchase:checkout_session:{checkout_session_id}",
            credit_kind=PURCHASE_CREDIT_KIND,
            amount_musd=amount_musd,
            priority=PURCHASE_PRIORITY,
            end_time=now + timedelta(days=PURCHASE_LIFETIME_DAYS),
            now=now,
        )

    async def grant_starter_credits(
        self,
        *,
        organization_id: UUID,
        amount_musd: int,
        now: Optional[datetime] = None,
    ) -> WalletCreditDTO:
        """Move an organization's remaining starter-credits proxy budget into the wallet,
        expiring after twelve months. Idempotent per organization: a rerun returns the
        first transfer whatever amount it is called with."""
        now = now or datetime.now(timezone.utc)
        return await self.wallets_dao.award_credit(
            organization_id=organization_id,
            idempotency_key=f"starter_credits:organization:{organization_id}",
            credit_kind=STARTER_CREDITS_KIND,
            amount_musd=amount_musd,
            priority=STARTER_CREDITS_PRIORITY,
            end_time=now + timedelta(days=STARTER_CREDITS_LIFETIME_DAYS),
            now=now,
        )
