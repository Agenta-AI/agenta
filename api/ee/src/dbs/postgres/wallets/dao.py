from datetime import datetime
from typing import List, Optional
from uuid import UUID

import uuid_utils.compat as uuid_utils
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import aliased

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.utils.logging import get_module_logger

from ee.src.core.wallets.contracts import DebitCommandV1
from ee.src.core.wallets.grants import GrantCapReachedError
from ee.src.core.wallets.plans import LAZY_PROVISION_FLOOR_MUSD
from ee.src.core.wallets.types import (
    WalletBalanceDTO,
    WalletCreditDTO,
    WalletDebitDTO,
    WalletGeneralBalanceNotFoundError,
    WalletSpendableBalanceDTO,
    WalletsDAOInterface,
    deficit_repayment,
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


def _general_balance_filter(organization_id: UUID):
    return (
        WalletBalanceDBE.organization_id == organization_id,
        WalletBalanceDBE.wallet_credit_id.is_(None),
    )


async def _mint_credit(
    session,
    *,
    organization_id: UUID,
    credit_kind: str,
    amount_musd: int,
    priority: int,
    start_time: Optional[datetime],
    end_time: Optional[datetime],
    data: dict,
    balance_musd: int,
) -> WalletCreditDBE:
    """Add a credit and its balance row, funded with `balance_musd`."""
    credit = WalletCreditDBE(
        id=uuid_utils.uuid7(),
        organization_id=organization_id,
        credit_kind=credit_kind,
        amount_musd=amount_musd,
        priority=priority,
        start_time=start_time,
        end_time=end_time,
        data=data,
    )
    session.add(credit)
    # `wallet_balances.wallet_credit_id` is a table-level FK with no ORM relationship
    # behind it, so the unit of work has nothing to order these two INSERTs by. Flush the
    # credit first or Postgres rejects the balance row.
    await session.flush()

    session.add(
        WalletBalanceDBE(
            id=uuid_utils.uuid7(),
            organization_id=organization_id,
            wallet_credit_id=credit.id,
            balance_musd=balance_musd,
            floor_musd=None,
        )
    )
    return credit


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

        Some organizations have no row: created while the flag was off, or by a path
        that skips provisioning (open-designs item 14). No plan lookup is needed:
        `LAZY_PROVISION_FLOOR_MUSD` is every plan's floor.
        The insert is idempotent (partial unique index) and rides this transaction, so
        a rolled-back settlement leaves no row behind.
        """
        general_stmt = (
            select(WalletBalanceDBE)
            .where(*_general_balance_filter(organization_id))
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
                *_general_balance_filter(organization_id)
            )
            result = await session.execute(stmt)
            balance = result.scalar_one_or_none()

            return balance_dbe_to_dto(balance) if balance is not None else None

    async def get_spendable_balance(
        self,
        *,
        organization_id: UUID,
    ) -> Optional[WalletSpendableBalanceDTO]:
        # The complement of settlement's `end_time > now()` candidate filter, on the
        # same database clock, so admission and settlement agree on what has expired.
        # Aliased so the subquery does not auto-correlate to the outer general row.
        credit_balance = aliased(WalletBalanceDBE)
        expired_remaining = (
            select(func.coalesce(func.sum(credit_balance.balance_musd), 0))
            .join(
                WalletCreditDBE,
                WalletCreditDBE.id == credit_balance.wallet_credit_id,
            )
            .where(
                WalletCreditDBE.organization_id == organization_id,
                WalletCreditDBE.end_time <= func.now(),
            )
            .scalar_subquery()
        )

        # One statement, one snapshot: a settlement committing between two separate
        # reads could move value between the two terms and skew the difference.
        stmt = select(
            WalletBalanceDBE.balance_musd - expired_remaining,
            WalletBalanceDBE.floor_musd,
        ).where(*_general_balance_filter(organization_id))

        async with self.engine.session() as session:
            row = (await session.execute(stmt)).one_or_none()

        if row is None:
            return None

        spendable_musd, floor_musd = row
        return WalletSpendableBalanceDTO(
            organization_id=organization_id,
            spendable_musd=spendable_musd,
            floor_musd=floor_musd,
        )

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
            #    Expiry is judged on the database clock, the one admission reads too;
            #    `plan_settlement` re-filters, so it gets the same instant. The wall
            #    clock after the lock, not `now()`: that is the transaction start, which
            #    precedes any wait above, and a credit may have expired during it.
            db_now = (
                await session.execute(select(func.clock_timestamp()))
            ).scalar_one()
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
                        WalletCreditDBE.end_time > db_now,
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
            plan = plan_settlement(command=command, candidates=candidates, now=db_now)

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
                *_general_balance_filter(organization_id)
            )
            balance = (await session.execute(stmt)).scalar_one_or_none()

            if balance is None:
                raise WalletGeneralBalanceNotFoundError(organization_id)

            return balance_dbe_to_dto(balance)

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
        cap_count: Optional[int] = None,
        cap_since: Optional[datetime] = None,
    ) -> WalletCreditDTO:
        async with self.engine.session() as session:
            # 1. Lock the general balance first, provisioning it when missing: every
            #    write below touches it, and this serializes concurrent awards for the
            #    same organization.
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

            # Counted under the lock, so racing awards cannot pass the cap together.
            if cap_count is not None and cap_since is not None:
                awarded = (
                    await session.execute(
                        select(func.count(WalletCreditDBE.id)).where(
                            WalletCreditDBE.organization_id == organization_id,
                            WalletCreditDBE.credit_kind == credit_kind,
                            WalletCreditDBE.start_time >= cap_since,
                        )
                    )
                ).scalar_one()
                if awarded >= cap_count:
                    raise GrantCapReachedError(credit_kind, cap_count)

            # 3. First delivery: mint the credit and its balance row, and fund the
            #    general balance projection by the full amount. The part that repays
            #    an outstanding deficit is spent at once, off the credit's row.
            credit_balances_musd = (
                await session.execute(
                    select(
                        func.coalesce(func.sum(WalletBalanceDBE.balance_musd), 0)
                    ).where(
                        WalletBalanceDBE.organization_id == organization_id,
                        WalletBalanceDBE.wallet_credit_id.is_not(None),
                    )
                )
            ).scalar_one()
            repaid_musd = deficit_repayment(
                credit_kind=credit_kind,
                amount_musd=amount_musd,
                # SUM over bigint is numeric: a Decimal, which the JSONB data refuses.
                credit_balances_musd=int(credit_balances_musd),
                general_balance_musd=general.balance_musd,
            )
            data: dict = {"references": {"award_idempotency_key": idempotency_key}}
            if repaid_musd:
                data["repaid_deficit_musd"] = repaid_musd
            credit = await _mint_credit(
                session,
                organization_id=organization_id,
                credit_kind=credit_kind,
                amount_musd=amount_musd,
                priority=priority,
                start_time=now,
                end_time=end_time,
                data=data,
                balance_musd=amount_musd - repaid_musd,
            )
            general.balance_musd += amount_musd

            await session.flush()

            return credit_dbe_to_dto(credit)
