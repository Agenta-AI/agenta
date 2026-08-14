from typing import List, Optional

import uuid_utils.compat as uuid_utils
from sqlalchemy import func, or_, select

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.utils.logging import get_module_logger

from ee.src.core.wallets.contracts import DebitCommandV1
from ee.src.core.wallets.types import (
    WalletBalanceDTO,
    WalletDebitDTO,
    WalletGeneralBalanceNotFoundError,
    WalletsDAOInterface,
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
