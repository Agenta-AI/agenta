"""In-memory `WalletsDAOInterface` fake for unit-testing `WalletsService` without Postgres.

Mirrors the real DAO's transaction shape (lock general balance, replay-check by
idempotency_key, plan via `plan_settlement`, apply deltas) using plain dicts instead of SQL,
so `WalletsService.check()`/`settle()` and the runtime factory wiring are testable in
isolation from `ee.src.dbs.postgres.wallets.dao.WalletsDAO`.
"""

from datetime import datetime
from typing import Dict, List, Optional, Tuple
from uuid import UUID

import uuid_utils.compat as uuid_utils

from ee.src.core.wallets.contracts import DebitCommandV1
from ee.src.core.wallets.interfaces import WalletSettlementPort
from ee.src.core.wallets.types import (
    CreditCandidateDTO,
    PlanChangeResultDTO,
    WalletBalanceDTO,
    WalletCreditDTO,
    WalletDebitDTO,
    WalletsDAOInterface,
    compose_debit_key,
    plan_settlement,
)


class FakeWalletsDAO(WalletsDAOInterface):
    def __init__(
        self,
        *,
        general_balance: Optional[WalletBalanceDTO] = None,
        credits: Optional[List[Tuple[CreditCandidateDTO, WalletBalanceDTO]]] = None,
    ):
        self.general_balance = general_balance
        # wallet_credit_id -> (candidate snapshot, balance row)
        self._credits: Dict[UUID, Tuple[CreditCandidateDTO, WalletBalanceDTO]] = {
            candidate.wallet_credit_id: (candidate, balance)
            for candidate, balance in (credits or [])
        }
        self.debits: List[WalletDebitDTO] = []
        self.get_general_balance_calls = 0
        self.settle_calls = 0
        self.provision_calls = 0
        self.plan_changes: Dict[Tuple[UUID, str], PlanChangeResultDTO] = {}

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

    async def settle(
        self,
        *,
        command: DebitCommandV1,
    ) -> List[WalletDebitDTO]:
        self.settle_calls += 1

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
            for candidate, _ in self._credits.values()
            if True  # organization scoping is implicit: fixtures are single-organization in tests
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
    ) -> None:
        self.provision_calls += 1

        if (
            self.general_balance is not None
            and self.general_balance.organization_id == organization_id
        ):
            return  # already provisioned — idempotent no-op, mirrors ON CONFLICT DO NOTHING

        self.general_balance = WalletBalanceDTO(
            id=uuid_utils.uuid7(),
            organization_id=organization_id,
            wallet_credit_id=None,
            balance_musd=0,
            floor_musd=floor_musd,
        )

    async def get_active_plan_allowance_credit(
        self,
        *,
        organization_id: UUID,
    ) -> Optional[WalletCreditDTO]:
        for candidate, _ in self._credits.values():
            if candidate.credit_kind == "plan_allowance":
                return WalletCreditDTO(
                    id=candidate.wallet_credit_id,
                    organization_id=organization_id,
                    credit_kind=candidate.credit_kind,
                    amount_musd=candidate.balance_musd,
                    priority=candidate.priority,
                    end_time=candidate.end_time,
                )
        return None

    async def apply_plan_change(
        self,
        *,
        organization_id: UUID,
        idempotency_key: str,
        outgoing_credit_id: Optional[UUID],
        outgoing_debit_amount_musd: int,
        incoming_credit_kind: str,
        incoming_credit_amount_musd: int,
        incoming_priority: int,
        incoming_end_time,
        floor_musd: int,
        now: Optional[datetime] = None,
    ) -> PlanChangeResultDTO:
        key = (organization_id, idempotency_key)
        if key in self.plan_changes:
            return self.plan_changes[key].model_copy(update={"replayed": True})

        if self.general_balance is None:
            from ee.src.core.wallets.types import WalletGeneralBalanceNotFoundError

            raise WalletGeneralBalanceNotFoundError(organization_id)

        applied_outgoing = 0
        outgoing_debit_id = None
        if outgoing_credit_id is not None and outgoing_debit_amount_musd > 0:
            candidate, balance = self._credits.get(outgoing_credit_id, (None, None))
            if balance is not None:
                applied_outgoing = min(outgoing_debit_amount_musd, balance.balance_musd)
                if applied_outgoing > 0:
                    outgoing_debit_id = uuid_utils.uuid7()
                    updated_candidate = candidate.model_copy(
                        update={
                            "balance_musd": candidate.balance_musd - applied_outgoing
                        }
                    )
                    updated_balance = balance.model_copy(
                        update={"balance_musd": balance.balance_musd - applied_outgoing}
                    )
                    self._credits[outgoing_credit_id] = (
                        updated_candidate,
                        updated_balance,
                    )
                    self.debits.append(
                        WalletDebitDTO(
                            id=outgoing_debit_id,
                            organization_id=organization_id,
                            debit_kind="adjustment",
                            amount_musd=applied_outgoing,
                            wallet_credit_id=outgoing_credit_id,
                            idempotency_key=idempotency_key,
                            debit_key=compose_debit_key(
                                idempotency_key=idempotency_key,
                                source=str(outgoing_credit_id),
                            ),
                            resource_key="wallet:plan_change",
                            pricing_version="plan-change-proration-v1",
                        )
                    )

        applied_incoming = 0
        incoming_credit_id = None
        if incoming_credit_amount_musd > 0:
            applied_incoming = incoming_credit_amount_musd
            incoming_credit_id = uuid_utils.uuid7()
            new_candidate = CreditCandidateDTO(
                wallet_credit_id=incoming_credit_id,
                credit_kind=incoming_credit_kind,
                priority=incoming_priority,
                end_time=incoming_end_time,
                balance_musd=applied_incoming,
            )
            new_balance = WalletBalanceDTO(
                id=uuid_utils.uuid7(),
                organization_id=organization_id,
                wallet_credit_id=incoming_credit_id,
                balance_musd=applied_incoming,
            )
            self._credits[incoming_credit_id] = (new_candidate, new_balance)

        self.general_balance = self.general_balance.model_copy(
            update={
                "balance_musd": self.general_balance.balance_musd
                + applied_incoming
                - applied_outgoing,
                "floor_musd": floor_musd,
            }
        )

        result = PlanChangeResultDTO(
            replayed=False,
            outgoing_credit_id=outgoing_credit_id,
            outgoing_debit_id=outgoing_debit_id,
            outgoing_debit_amount_musd=applied_outgoing,
            incoming_credit_id=incoming_credit_id,
            incoming_credit_amount_musd=applied_incoming,
            general_balance_musd=self.general_balance.balance_musd,
            floor_musd=self.general_balance.floor_musd,
        )
        self.plan_changes[key] = result
        return result


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
