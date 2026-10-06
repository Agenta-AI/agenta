"""In-memory `WalletsDAOInterface` fake for unit-testing `WalletsService` without Postgres.

Mirrors the real DAO's transaction shape (lock general balance, replay-check by
idempotency_key, plan via `plan_settlement`, apply deltas) using plain dicts instead of SQL,
so `WalletsService.check()`/`settle()` and the runtime factory wiring are testable in
isolation from `ee.src.dbs.postgres.wallets.dao.WalletsDAO`.
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from uuid import UUID

import uuid_utils.compat as uuid_utils

from ee.src.core.wallets.contracts import DebitCommandV1
from ee.src.core.wallets.interfaces import WalletSettlementPort
from ee.src.core.wallets.types import (
    CreditCandidateDTO,
    WalletBalanceDTO,
    WalletCreditDTO,
    WalletDebitDTO,
    WalletSpendableBalanceDTO,
    WalletsDAOInterface,
    deficit_repayment,
    plan_settlement,
)


class FakeWalletsDAO(WalletsDAOInterface):
    def __init__(
        self,
        *,
        general_balance: Optional[WalletBalanceDTO] = None,
        credits: Optional[List[Tuple[CreditCandidateDTO, WalletBalanceDTO]]] = None,
        can_provision: bool = True,
    ):
        self.general_balance = general_balance
        # False simulates the real DAO's defensive branch: the general balance row is
        # neither present nor insertable, so the write paths raise instead of healing.
        self.can_provision = can_provision
        # wallet_credit_id -> (candidate snapshot, balance row)
        self._credits: Dict[UUID, Tuple[CreditCandidateDTO, WalletBalanceDTO]] = {
            candidate.wallet_credit_id: (candidate, balance)
            for candidate, balance in (credits or [])
        }
        self.debits: List[WalletDebitDTO] = []
        self.get_general_balance_calls = 0
        self.settle_calls = 0
        self.provision_calls = 0
        # idempotency_key -> awarded credit, keyed same as the real DAO's
        # `data.references.award_idempotency_key` lookup.
        self.awards: Dict[str, WalletCreditDTO] = {}
        self.award_calls = 0

    def _owned_credits(
        self, *, organization_id: UUID
    ) -> List[Tuple[CreditCandidateDTO, WalletBalanceDTO]]:
        """The credits this organization owns, and only those.

        `CreditCandidateDTO` carries no `organization_id` — the real DAO's SQL scopes the
        candidate select by `wallet_credits.organization_id` before it builds candidates,
        so the DTO never needs the column. The fake has to apply that scope itself, and
        the paired `wallet_balances` row is where it holds the owner. Without this, a
        fixture holding two organizations' credits would let one organization spend the
        other's, and a unit test would go green on funds production would never select.

        Expiry and a positive balance are NOT filtered here on purpose: `plan_settlement`
        re-derives both (see its docstring), so the fake would be asserting a rule twice
        and could drift from the one the service actually runs.
        """
        return [
            (candidate, balance)
            for candidate, balance in self._credits.values()
            if balance.organization_id == organization_id
        ]

    async def _lock_general_balance(self, *, organization_id: UUID) -> WalletBalanceDTO:
        """Mirrors `WalletsDAO._lock_general_balance`: every write path opens with this,
        it is scoped to the caller's organization, and it provisions the row when it is
        missing rather than raising."""
        if (
            self.general_balance is not None
            and self.general_balance.organization_id == organization_id
        ):
            return self.general_balance

        if not self.can_provision:
            from ee.src.core.wallets.types import WalletGeneralBalanceNotFoundError

            raise WalletGeneralBalanceNotFoundError(organization_id)

        return await self.provision_general_balance(organization_id=organization_id)

    async def get_general_balance(
        self,
        *,
        organization_id: UUID,
    ) -> Optional[WalletBalanceDTO]:
        self.get_general_balance_calls += 1

        if self.general_balance is None:
            return None
        if self.general_balance.organization_id != organization_id:
            return None
        return self.general_balance

    async def get_spendable_balance(
        self,
        *,
        organization_id: UUID,
    ) -> Optional[WalletSpendableBalanceDTO]:
        general = await self.get_general_balance(organization_id=organization_id)
        if general is None:
            return None

        now = datetime.now(timezone.utc)
        expired_remaining = sum(
            balance.balance_musd
            for candidate, balance in self._owned_credits(
                organization_id=organization_id
            )
            if candidate.end_time is not None and candidate.end_time <= now
        )
        return WalletSpendableBalanceDTO(
            organization_id=organization_id,
            spendable_musd=general.balance_musd - expired_remaining,
            floor_musd=general.floor_musd,
        )

    async def settle(
        self,
        *,
        command: DebitCommandV1,
    ) -> List[WalletDebitDTO]:
        self.settle_calls += 1

        await self._lock_general_balance(organization_id=command.organization_id)

        existing = [
            debit
            for debit in self.debits
            if debit.organization_id == command.organization_id
            and debit.idempotency_key == command.idempotency_key
        ]
        if existing:
            return existing

        candidates = [
            candidate
            for candidate, _ in self._owned_credits(
                organization_id=command.organization_id
            )
        ]
        plan = plan_settlement(command=command, candidates=candidates)

        created: List[WalletDebitDTO] = []
        for write in plan.debit_writes:
            debit = WalletDebitDTO(
                id=uuid_utils.uuid7(),
                organization_id=command.organization_id,
                debit_kind=command.debit_kind.value,
                amount_musd=write.amount_musd,
                wallet_credit_id=write.wallet_credit_id,
                idempotency_key=command.idempotency_key,
                debit_key=write.debit_key,
                resource_key=command.resource_key,
                resource_locator=command.resource_locator or {},
                pricing_version=command.pricing_version,
                data={},
                created_at=command.created_at,
            )
            created.append(debit)
            self.debits.append(debit)

        for credit_id, delta in plan.credit_balance_deltas.items():
            candidate, balance = self._credits[credit_id]
            updated_candidate = candidate.model_copy(
                update={"balance_musd": candidate.balance_musd - delta}
            )
            updated_balance = balance.model_copy(
                update={"balance_musd": balance.balance_musd - delta}
            )
            self._credits[credit_id] = (updated_candidate, updated_balance)

        if self.general_balance is not None:
            self.general_balance = self.general_balance.model_copy(
                update={
                    "balance_musd": self.general_balance.balance_musd
                    - plan.general_balance_delta
                }
            )

        return created

    async def provision_general_balance(
        self,
        *,
        organization_id: UUID,
        floor_musd: int = 0,
    ) -> WalletBalanceDTO:
        self.provision_calls += 1

        if (
            self.general_balance is not None
            and self.general_balance.organization_id == organization_id
        ):
            # Already provisioned — idempotent no-op returning the row that exists, not
            # the one proposed. Mirrors the real DAO's ON CONFLICT DO NOTHING plus
            # read-back.
            return self.general_balance

        self.general_balance = WalletBalanceDTO(
            id=uuid_utils.uuid7(),
            organization_id=organization_id,
            wallet_credit_id=None,
            balance_musd=0,
            floor_musd=floor_musd,
        )

        return self.general_balance

    async def get_awarded_credit(
        self,
        *,
        organization_id: UUID,
        idempotency_key: str,
    ) -> Optional[WalletCreditDTO]:
        credit = self.awards.get(idempotency_key)
        return credit if credit and credit.organization_id == organization_id else None

    async def award_credit(
        self,
        *,
        organization_id: UUID,
        idempotency_key: str,
        credit_kind: str,
        amount_musd: int,
        priority: int,
        end_time,
        now: Optional[datetime] = None,
    ) -> WalletCreditDTO:
        self.award_calls += 1

        existing = self.awards.get(idempotency_key)
        if existing is not None:
            return existing

        await self._lock_general_balance(organization_id=organization_id)

        repaid_musd = deficit_repayment(
            credit_kind=credit_kind,
            amount_musd=amount_musd,
            credit_balances_musd=sum(
                balance.balance_musd
                for _, balance in self._owned_credits(organization_id=organization_id)
            ),
            general_balance_musd=self.general_balance.balance_musd,
        )
        credit_id = uuid_utils.uuid7()
        credit = WalletCreditDTO(
            id=credit_id,
            organization_id=organization_id,
            credit_kind=credit_kind,
            amount_musd=amount_musd,
            priority=priority,
            start_time=now,
            end_time=end_time,
            data={"references": {"award_idempotency_key": idempotency_key}},
        )
        candidate = CreditCandidateDTO(
            wallet_credit_id=credit_id,
            credit_kind=credit_kind,
            priority=priority,
            end_time=end_time,
            balance_musd=amount_musd - repaid_musd,
        )
        balance = WalletBalanceDTO(
            id=uuid_utils.uuid7(),
            organization_id=organization_id,
            wallet_credit_id=credit_id,
            balance_musd=amount_musd - repaid_musd,
        )
        self._credits[credit_id] = (candidate, balance)
        self.general_balance = self.general_balance.model_copy(
            update={"balance_musd": self.general_balance.balance_musd + amount_musd}
        )
        self.awards[idempotency_key] = credit
        return credit


class FakeWalletSettlementPort(WalletSettlementPort):
    """In-memory `WalletSettlementPort` for `DebitWorker` unit tests. Records every call
    (in order, with the exact command received) and replays the same idempotency-keyed
    "financial effect" list it already produced for a duplicate delivery — no second
    effect — mirroring the real DAO's replay-check without any DB or plan_settlement math.
    Optionally raises on the next call to simulate a transient settlement failure."""

    def __init__(self):
        self.calls: List[DebitCommandV1] = []
        self.effects: Dict[Tuple[UUID, str], int] = {}
        self.raise_next: Optional[Exception] = None

    async def settle(self, command: DebitCommandV1) -> None:
        self.calls.append(command)

        if self.raise_next is not None:
            error, self.raise_next = self.raise_next, None
            raise error

        key = (command.organization_id, command.idempotency_key)
        if key in self.effects:
            return  # replay: no second financial effect

        self.effects[key] = self.effects.get(key, 0) + 1
