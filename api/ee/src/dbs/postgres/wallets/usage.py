"""Core-DB reads for the wallet usage view: credits with what remains on them, the
gateway-usage postings, and the names the view shows beside them."""

import json
from datetime import datetime
from typing import Dict, Iterable, List
from uuid import UUID

from sqlalchemy import Text, cast, func, select

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.workflows.dbes import WorkflowArtifactDBE
from oss.src.models.db_models import UserDB

from ee.src.core.wallets.contracts import DebitKind
from ee.src.core.wallets.usage.dtos import WalletCreditUsage, WalletUsageDebit
from ee.src.core.wallets.usage.interfaces import WalletUsageDAOInterface
from ee.src.dbs.postgres.wallets.dbes import (
    WalletBalanceDBE,
    WalletCreditDBE,
    WalletDebitDBE,
)


class WalletUsageDAO(WalletUsageDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        self.engine = engine or get_transactions_engine()

    async def list_credits(self, *, organization_id: UUID) -> List[WalletCreditUsage]:
        stmt = (
            select(WalletCreditDBE, WalletBalanceDBE.balance_musd)
            .join(
                WalletBalanceDBE,
                WalletBalanceDBE.wallet_credit_id == WalletCreditDBE.id,
            )
            .where(
                WalletCreditDBE.organization_id == organization_id,
                WalletCreditDBE.deleted_at.is_(None),
            )
            .order_by(WalletCreditDBE.priority, WalletCreditDBE.created_at)
        )
        async with self.engine.session() as session:
            rows = (await session.execute(stmt)).all()
        return [
            WalletCreditUsage(
                id=credit.id,
                credit_kind=credit.credit_kind,
                amount_musd=credit.amount_musd,
                remaining_musd=remaining,
                priority=credit.priority,
                start_time=credit.start_time,
                end_time=credit.end_time,
                created_at=credit.created_at,
            )
            for credit, remaining in rows
        ]

    async def list_usage_debits(
        self,
        *,
        organization_id: UUID,
        start: datetime,
        end: datetime,
        limit: int,
    ) -> List[WalletUsageDebit]:
        created_at = func.min(WalletDebitDBE.created_at)
        stmt = (
            select(
                WalletDebitDBE.idempotency_key,
                func.sum(WalletDebitDBE.amount_musd),
                WalletDebitDBE.resource_key,
                func.min(cast(WalletDebitDBE.resource_locator, Text)),
                WalletDebitDBE.pricing_version,
                created_at,
            )
            .where(
                WalletDebitDBE.organization_id == organization_id,
                WalletDebitDBE.debit_kind == DebitKind.GATEWAY_USAGE.value,
                WalletDebitDBE.created_at >= start,
                WalletDebitDBE.created_at < end,
                WalletDebitDBE.deleted_at.is_(None),
            )
            .group_by(
                WalletDebitDBE.idempotency_key,
                WalletDebitDBE.resource_key,
                WalletDebitDBE.pricing_version,
            )
            .order_by(created_at.desc())
            .limit(limit)
        )
        async with self.engine.session() as session:
            rows = (await session.execute(stmt)).all()
        return [
            WalletUsageDebit(
                idempotency_key=key,
                amount_musd=int(amount),
                resource_key=resource_key,
                resource_locator=_json_object(locator),
                pricing_version=pricing_version,
                created_at=created,
            )
            for key, amount, resource_key, locator, pricing_version, created in rows
        ]

    async def user_emails(self, *, user_ids: Iterable[UUID]) -> Dict[UUID, str]:
        ids = list(user_ids)
        if not ids:
            return {}
        async with self.engine.session() as session:
            rows = (
                await session.execute(
                    select(UserDB.id, UserDB.email).where(UserDB.id.in_(ids))
                )
            ).all()
        return {user_id: email for user_id, email in rows}

    async def agent_names(self, *, agent_ids: Iterable[UUID]) -> Dict[UUID, str]:
        ids = list(agent_ids)
        if not ids:
            return {}
        async with self.engine.session() as session:
            rows = (
                await session.execute(
                    select(WorkflowArtifactDBE.id, WorkflowArtifactDBE.name).where(
                        WorkflowArtifactDBE.id.in_(ids)
                    )
                )
            ).all()
        return {agent_id: name for agent_id, name in rows if name}


def _json_object(text):
    if not text:
        return {}
    value = json.loads(text)
    return value if isinstance(value, dict) else {}
