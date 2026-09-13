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
from ee.src.core.wallets.plans import LAZY_PROVISION_FLOOR_MUSD
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
)
from ee.src.dbs.postgres.wallets.mappings import (
    balance_dbe_to_dto,
    candidate_from_dbes,
    credit_dbe_to_dto,
    debit_dbe_to_dto,
    debit_write_to_dbe,
)

log = get_module_logger(__name__)


def _general_balance_insert(*, organization_id: UUID, floor_musd: int):
    """The one definition of "insert this organization's general balance row if it does
    not exist". ON CONFLICT targets the exact partial unique index — that index, not any
    application-level check-then-insert, is the guard against a duplicate row under a
    retry or a concurrent creation."""
    return (
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


class WalletsDAO(WalletsDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    async def _lock_general_balance(
        self,
        *,
        session,
        organization_id: UUID,
    ) -> WalletBalanceDBE:
        """Lock the organization's general balance row, provisioning it first when it is
        absent. Every write path below opens with this call, so each of them serializes
        on the same row for the same organization.

        Lazy provisioning is what closes the `AGENTA_WALLETS_ENABLED` gap recorded as
        item 14 of `docs/design/wallets-research/v1/open-designs.md`: an organization
        created while the flag was off was skipped by `provision_signup_subscription`,
        and the `ee0000000005` backfill has already run and will not run again, so
        nothing else would ever give it a row. Provisioning here needs no plan lookup —
        `LAZY_PROVISION_FLOOR_MUSD` is every known plan's floor today, and a plan change
        rewrites the floor anyway.

        The insert is idempotent (partial unique index) and rides this transaction, so a
        rolled-back settlement leaves no row behind and the next delivery provisions
        again. `WalletGeneralBalanceNotFoundError` is therefore no longer a routine
        outcome; it survives as a defensive invariant for the case where the row is
        neither present nor insertable.
        """
        general_stmt = (
            select(WalletBalanceDBE)
            .where(
                WalletBalanceDBE.organization_id == organization_id,
                WalletBalanceDBE.wallet_credit_id.is_(None),
            )
            .with_for_update()
        )

        general = (await session.execute(general_stmt)).scalar_one_or_none()
        if general is not None:
            return general

        await session.execute(
            _general_balance_insert(
                organization_id=organization_id,
                floor_musd=LAZY_PROVISION_FLOOR_MUSD,
            )
        )
        await session.flush()

        # Re-read under the lock. A concurrent transaction that inserted the row first
        # blocks the statement above on the unique index and then makes its row visible
        # here, so the winner of that race is irrelevant: both callers end up holding the
        # same single row.
        general = (await session.execute(general_stmt)).scalar_one_or_none()
        if general is None:
            raise WalletGeneralBalanceNotFoundError(organization_id)

        log.info(
            "[WALLETS] Provisioned a missing general balance row lazily",
            organization_id=str(organization_id),
            floor_musd=LAZY_PROVISION_FLOOR_MUSD,
        )

        return general

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
            # 1. Lock the organization general balance FIRST, provisioning it when it is
            #    missing. Every posting for this organization touches this one row, so
            #    this lock also serializes every concurrent settle() call for the
            #    organization — the mechanism that keeps competing deliveries from
            #    overspending any one credit.
            general = await self._lock_general_balance(
                session=session,
                organization_id=command.organization_id,
            )

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
    ) -> WalletBalanceDTO:
        async with self.engine.session() as session:
            await session.execute(
                _general_balance_insert(
                    organization_id=organization_id,
                    floor_musd=floor_musd,
                )
            )
            await session.flush()

            # Read back rather than returning what was inserted: on the conflict path
            # nothing was inserted, and the caller wants the row that actually exists.
            stmt = select(WalletBalanceDBE).where(
                WalletBalanceDBE.organization_id == organization_id,
                WalletBalanceDBE.wallet_credit_id.is_(None),
            )
            balance = (await session.execute(stmt)).scalar_one_or_none()

            if balance is None:
                raise WalletGeneralBalanceNotFoundError(organization_id)

            return balance_dbe_to_dto(balance)

    async def get_active_plan_allowance_credit(
        self,
        *,
        organization_id: UUID,
        now: Optional[datetime] = None,
    ) -> Optional[WalletCreditDTO]:
        # "Unexpired" is relative to the caller's logical clock when it has one — the
        # same `now` `apply_plan_change` prorates against, so one plan change reads a
        # single instant. Falling back to the database clock keeps the pre-existing
        # behavior for callers that pass nothing.
        cutoff = now if now is not None else func.now()

        stmt = (
            select(WalletCreditDBE)
            .where(
                WalletCreditDBE.organization_id == organization_id,
                WalletCreditDBE.credit_kind == "plan_allowance",
                or_(
                    WalletCreditDBE.end_time.is_(None),
                    WalletCreditDBE.end_time > cutoff,
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
            # 1. Lock the general balance first, provisioning it when missing — every
            #    write below touches it, and this also serializes concurrent plan changes
            #    for the same organization.
            general = await self._lock_general_balance(
                session=session,
                organization_id=organization_id,
            )

            # 2. Replay guard — checked BEFORE any amount is applied. No dedicated ledger
            #    table: the outgoing side rides the exact same (organization_id,
            #    idempotency_key) mechanism `settle()` uses against `wallet_debits`; the
            #    incoming side is self-correlating via the `plan_change_idempotency_key`
            #    reference already stored in the minted `wallet_credits` row's `data`
            #    (below) — no second guard, just reading the actual financial rows a prior
            #    application would have written. A redelivered webhook (even one that
            #    would now compute a different amount, since proration is a function of
            #    wall-clock `now`) returns the ORIGINAL application's result and writes
            #    nothing new.
            existing_debit_stmt = (
                select(WalletDebitDBE)
                .where(
                    WalletDebitDBE.organization_id == organization_id,
                    WalletDebitDBE.idempotency_key == idempotency_key,
                )
                .limit(1)
            )
            existing_debit = (
                (await session.execute(existing_debit_stmt)).scalars().first()
            )

            existing_credit_stmt = select(WalletCreditDBE).where(
                WalletCreditDBE.organization_id == organization_id,
                WalletCreditDBE.data["references"]["plan_change_idempotency_key"].astext
                == idempotency_key,
            )
            existing_credit = (
                await session.execute(existing_credit_stmt)
            ).scalar_one_or_none()

            if existing_debit is not None or existing_credit is not None:
                return PlanChangeResultDTO(
                    replayed=True,
                    outgoing_credit_id=(
                        existing_debit.wallet_credit_id if existing_debit else None
                    ),
                    outgoing_debit_id=existing_debit.id if existing_debit else None,
                    outgoing_debit_amount_musd=(
                        existing_debit.amount_musd if existing_debit else 0
                    ),
                    incoming_credit_id=existing_credit.id if existing_credit else None,
                    incoming_credit_amount_musd=(
                        existing_credit.amount_musd if existing_credit else 0
                    ),
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
                # `wallet_balances.wallet_credit_id` is a table-level FK with no ORM
                # relationship behind it, so the unit of work has nothing to order these
                # two INSERTs by. Flush the credit first or Postgres rejects the balance
                # row on `wallet_balances_wallet_credit_id_fkey`.
                await session.flush()

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

            # No ledger row: when both applied amounts are zero, nothing above was
            # written — a no-op is a correct outcome for a zero-value change and has
            # nothing to replay-guard. When either amount is nonzero, the row(s) written
            # above ARE the replay guard for the next delivery of this key (step 2).
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

    async def award_credit(
        self,
        *,
        organization_id: UUID,
        idempotency_key: str,
        credit_kind: str,
        amount_musd: int,
        priority: int,
        end_time: Optional[datetime],
        now: Optional[datetime] = None,
    ) -> WalletCreditDTO:
        async with self.engine.session() as session:
            # 1. Lock the general balance first, provisioning it when missing — same
            #    reason as `apply_plan_change`: every write below touches it, and this
            #    serializes concurrent awards for the same organization.
            general = await self._lock_general_balance(
                session=session,
                organization_id=organization_id,
            )

            # 2. Replay guard: an existing credit already carrying this idempotency key
            #    is this exact award, already applied — return it, write nothing new.
            existing_stmt = select(WalletCreditDBE).where(
                WalletCreditDBE.organization_id == organization_id,
                WalletCreditDBE.data["references"]["award_idempotency_key"].astext
                == idempotency_key,
            )
            existing = (await session.execute(existing_stmt)).scalar_one_or_none()
            if existing is not None:
                return credit_dbe_to_dto(existing)

            # 3. First delivery: mint the credit and its balance row, and fund the
            #    general balance projection by the full amount.
            credit = WalletCreditDBE(
                id=uuid_utils.uuid7(),
                organization_id=organization_id,
                credit_kind=credit_kind,
                amount_musd=amount_musd,
                priority=priority,
                start_time=now,
                end_time=end_time,
                data={"references": {"award_idempotency_key": idempotency_key}},
            )
            session.add(credit)
            # Same FK-ordering constraint as `apply_plan_change`: no ORM relationship
            # ties `wallet_balances.wallet_credit_id` to `wallet_credits.id`, so the
            # credit INSERT has to be flushed before the balance row can reference it.
            await session.flush()

            session.add(
                WalletBalanceDBE(
                    id=uuid_utils.uuid7(),
                    organization_id=organization_id,
                    wallet_credit_id=credit.id,
                    balance_musd=amount_musd,
                    floor_musd=None,
                )
            )
            general.balance_musd += amount_musd

            await session.flush()

            return credit_dbe_to_dto(credit)
