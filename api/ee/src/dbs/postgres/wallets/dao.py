from datetime import datetime
from typing import List, Optional
from uuid import UUID

import uuid_utils.compat as uuid_utils
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.utils.logging import get_module_logger

from ee.src.core.wallets.contracts import DebitCommandV1
from ee.src.core.wallets.types import (
    PlanChangeResultDTO,
    WalletBalanceDTO,
    WalletCreditDTO,
    WalletDebitDTO,
    WalletGeneralBalanceNotFoundError,
    WalletsDAOInterface,
    compose_debit_key,
    plan_settlement,
)
from ee.src.dbs.postgres.wallets.dbes import (
    WalletBalanceDBE,
    WalletCreditDBE,
    WalletDebitDBE,
    WalletPlanChangeDBE,
)
from ee.src.dbs.postgres.wallets.mappings import (
    balance_dbe_to_dto,
    candidate_from_dbes,
    credit_dbe_to_dto,
    debit_dbe_to_dto,
    debit_write_to_dbe,
)

log = get_module_logger(__name__)


class WalletsDAO(WalletsDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    async def get_general_balance(
        self,
        *,
        organization_id,
    ) -> Optional[WalletBalanceDTO]:
        async with self.engine.session() as session:
            stmt = select(WalletBalanceDBE).where(
                WalletBalanceDBE.organization_id == organization_id,
                WalletBalanceDBE.wallet_credit_id.is_(None),
            )
            result = await session.execute(stmt)
            balance = result.scalar_one_or_none()

            return balance_dbe_to_dto(balance) if balance is not None else None

    async def settle(
        self,
        *,
        command: DebitCommandV1,
    ) -> List[WalletDebitDTO]:
        async with self.engine.session() as session:
            # 1. Lock the organization general balance FIRST. Every posting for this
            #    organization touches this one row, so this lock also serializes every
            #    concurrent settle() call for the organization — the mechanism that keeps
            #    competing deliveries from overspending any one credit.
            general_stmt = (
                select(WalletBalanceDBE)
                .where(
                    WalletBalanceDBE.organization_id == command.organization_id,
                    WalletBalanceDBE.wallet_credit_id.is_(None),
                )
                .with_for_update()
            )
            general = (await session.execute(general_stmt)).scalar_one_or_none()

            if general is None:
                raise WalletGeneralBalanceNotFoundError(command.organization_id)

            # 2. Replay check: this posting already settled — return the original rows,
            #    no second write.
            existing_stmt = (
                select(WalletDebitDBE)
                .where(
                    WalletDebitDBE.organization_id == command.organization_id,
                    WalletDebitDBE.idempotency_key == command.idempotency_key,
                )
                .order_by(WalletDebitDBE.debit_key.asc())
            )
            existing = (await session.execute(existing_stmt)).scalars().all()

            if existing:
                return [debit_dbe_to_dto(debit) for debit in existing]

            # 3. First delivery: select+lock unexpired, funded candidate credit balances
            #    in priority, end_time, credit_id order. Already serialized by the general
            #    balance lock above, so this snapshot cannot go stale under our feet.
            candidates_stmt = (
                select(WalletCreditDBE, WalletBalanceDBE)
                .join(
                    WalletBalanceDBE,
                    WalletBalanceDBE.wallet_credit_id == WalletCreditDBE.id,
                )
                .where(
                    WalletCreditDBE.organization_id == command.organization_id,
                    or_(
                        WalletCreditDBE.end_time.is_(None),
                        WalletCreditDBE.end_time > func.now(),
                    ),
                    WalletBalanceDBE.balance_musd > 0,
                )
                .order_by(
                    WalletCreditDBE.priority.asc(),
                    WalletCreditDBE.end_time.asc().nulls_last(),
                    WalletCreditDBE.id.asc(),
                )
                .with_for_update(of=WalletBalanceDBE)
            )
            rows = (await session.execute(candidates_stmt)).all()

            candidates = [
                candidate_from_dbes(credit=credit, balance=balance)
                for credit, balance in rows
            ]
            balance_by_credit_id = {
                balance.wallet_credit_id: balance for _, balance in rows
            }

            # 4. Plan the split: which credits fund how much, plus any deficit remainder.
            #    Pure function — no I/O, no locking decisions of its own.
            plan = plan_settlement(command=command, candidates=candidates)

            # 5. Insert one debit per actual funding source.
            created: List[WalletDebitDBE] = []
            for write in plan.debit_writes:
                debit = debit_write_to_dbe(
                    write=write,
                    command=command,
                    debit_id=uuid_utils.uuid7(),
                )
                session.add(debit)
                created.append(debit)

            # 6. Update every selected per-credit balance and the general balance.
            for credit_id, delta in plan.credit_balance_deltas.items():
                balance_by_credit_id[credit_id].balance_musd -= delta

            general.balance_musd -= plan.general_balance_delta

            await session.flush()

            return [debit_dbe_to_dto(debit) for debit in created]

    async def provision_general_balance(
        self,
        *,
        organization_id: UUID,
        floor_musd: int = 0,
    ) -> None:
        async with self.engine.session() as session:
            # ON CONFLICT targets the exact partial unique index — the actual guard
            # against a duplicate row on retry or concurrent creation, not this
            # application-level call itself.
            stmt = (
                pg_insert(WalletBalanceDBE)
                .values(
                    id=uuid_utils.uuid7(),
                    organization_id=organization_id,
                    wallet_credit_id=None,
                    balance_musd=0,
                    floor_musd=floor_musd,
                )
                .on_conflict_do_nothing(
                    index_elements=[WalletBalanceDBE.organization_id],
                    index_where=WalletBalanceDBE.wallet_credit_id.is_(None),
                )
            )
            await session.execute(stmt)
            await session.flush()

    async def get_active_plan_allowance_credit(
        self,
        *,
        organization_id: UUID,
    ) -> Optional[WalletCreditDTO]:
        stmt = (
            select(WalletCreditDBE)
            .where(
                WalletCreditDBE.organization_id == organization_id,
                WalletCreditDBE.credit_kind == "plan_allowance",
                or_(
                    WalletCreditDBE.end_time.is_(None),
                    WalletCreditDBE.end_time > func.now(),
                ),
            )
            .order_by(WalletCreditDBE.end_time.desc().nulls_last())
            .limit(1)
        )
        async with self.engine.session() as session:
            credit = (await session.execute(stmt)).scalars().first()
            return credit_dbe_to_dto(credit) if credit is not None else None

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
        incoming_end_time: datetime,
        floor_musd: int,
        now: Optional[datetime] = None,
    ) -> PlanChangeResultDTO:
        async with self.engine.session() as session:
            # 1. Lock the general balance first — every write below touches it, and this
            #    also serializes concurrent plan changes for the same organization.
            general_stmt = (
                select(WalletBalanceDBE)
                .where(
                    WalletBalanceDBE.organization_id == organization_id,
                    WalletBalanceDBE.wallet_credit_id.is_(None),
                )
                .with_for_update()
            )
            general = (await session.execute(general_stmt)).scalar_one_or_none()
            if general is None:
                raise WalletGeneralBalanceNotFoundError(organization_id)

            # 2. Replay guard — checked BEFORE any amount is applied. A redelivered
            #    webhook (even one that would now compute a different amount, since
            #    proration is a function of wall-clock `now`) returns the ORIGINAL
            #    application's result and writes nothing new.
            existing_stmt = select(WalletPlanChangeDBE).where(
                WalletPlanChangeDBE.organization_id == organization_id,
                WalletPlanChangeDBE.idempotency_key == idempotency_key,
            )
            existing = (await session.execute(existing_stmt)).scalar_one_or_none()
            if existing is not None:
                return PlanChangeResultDTO(
                    replayed=True,
                    outgoing_credit_id=existing.outgoing_credit_id,
                    outgoing_debit_id=existing.outgoing_debit_id,
                    outgoing_debit_amount_musd=existing.outgoing_debit_amount_musd,
                    incoming_credit_id=existing.incoming_credit_id,
                    incoming_credit_amount_musd=existing.incoming_credit_amount_musd,
                    general_balance_musd=general.balance_musd,
                    floor_musd=general.floor_musd,
                )

            outgoing_debit = None
            applied_outgoing_amount = 0
            if outgoing_credit_id is not None and outgoing_debit_amount_musd > 0:
                outgoing_balance_stmt = (
                    select(WalletBalanceDBE)
                    .where(WalletBalanceDBE.wallet_credit_id == outgoing_credit_id)
                    .with_for_update()
                )
                outgoing_balance = (
                    await session.execute(outgoing_balance_stmt)
                ).scalar_one_or_none()

                if outgoing_balance is not None:
                    # A per-credit balance must never go negative — cap the removed
                    # remainder at whatever is actually still on the credit.
                    applied_outgoing_amount = min(
                        outgoing_debit_amount_musd, outgoing_balance.balance_musd
                    )

                if applied_outgoing_amount > 0:
                    outgoing_debit = WalletDebitDBE(
                        id=uuid_utils.uuid7(),
                        organization_id=organization_id,
                        debit_kind="adjustment",
                        amount_musd=applied_outgoing_amount,
                        wallet_credit_id=outgoing_credit_id,
                        idempotency_key=idempotency_key,
                        debit_key=compose_debit_key(
                            idempotency_key=idempotency_key,
                            source=str(outgoing_credit_id),
                        ),
                        resource_key="wallet:plan_change",
                        resource_locator={},
                        pricing_version="plan-change-proration-v1",
                        data={},
                    )
                    session.add(outgoing_debit)
                    outgoing_balance.balance_musd -= applied_outgoing_amount

            incoming_credit = None
            applied_incoming_amount = 0
            if incoming_credit_amount_musd > 0:
                applied_incoming_amount = incoming_credit_amount_musd
                incoming_credit = WalletCreditDBE(
                    id=uuid_utils.uuid7(),
                    organization_id=organization_id,
                    credit_kind=incoming_credit_kind,
                    amount_musd=applied_incoming_amount,
                    priority=incoming_priority,
                    start_time=now,
                    end_time=incoming_end_time,
                    data={
                        "references": {"plan_change_idempotency_key": idempotency_key}
                    },
                )
                session.add(incoming_credit)
                incoming_balance = WalletBalanceDBE(
                    id=uuid_utils.uuid7(),
                    organization_id=organization_id,
                    wallet_credit_id=incoming_credit.id,
                    balance_musd=applied_incoming_amount,
                    floor_musd=None,
                )
                session.add(incoming_balance)

            # 3. General balance: net of what actually moved, plus the incoming plan's
            #    floor — always applied, even when this change moved zero value.
            general.balance_musd += applied_incoming_amount - applied_outgoing_amount
            general.floor_musd = floor_musd

            # 4. Ledger row: the replay guard for every future delivery of this key,
            #    including the all-zero case where nothing else was written above.
            ledger = WalletPlanChangeDBE(
                id=uuid_utils.uuid7(),
                organization_id=organization_id,
                idempotency_key=idempotency_key,
                outgoing_credit_id=outgoing_credit_id,
                outgoing_debit_id=outgoing_debit.id if outgoing_debit else None,
                outgoing_debit_amount_musd=applied_outgoing_amount,
                incoming_credit_id=incoming_credit.id if incoming_credit else None,
                incoming_credit_amount_musd=applied_incoming_amount,
            )
            session.add(ledger)

            await session.flush()

            return PlanChangeResultDTO(
                replayed=False,
                outgoing_credit_id=outgoing_credit_id,
                outgoing_debit_id=outgoing_debit.id if outgoing_debit else None,
                outgoing_debit_amount_musd=applied_outgoing_amount,
                incoming_credit_id=incoming_credit.id if incoming_credit else None,
                incoming_credit_amount_musd=applied_incoming_amount,
                general_balance_musd=general.balance_musd,
                floor_musd=general.floor_musd,
            )
