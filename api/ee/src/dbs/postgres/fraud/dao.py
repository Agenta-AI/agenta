from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.models.db_models import APIKeyDB, OrganizationDB, ProjectDB, UserDB

from ee.src.core.fraud.types import (
    NO_GRANTS_FLAG,
    PAID_CREDIT_KINDS,
    ApiKeySignals,
    BillingFacts,
    FraudCheckpoint,
    FraudDAOInterface,
)
from ee.src.dbs.postgres.subscriptions.dbes import SubscriptionDBE
from ee.src.dbs.postgres.wallets.dbes import WalletCreditDBE


def _domain(email: str) -> Optional[str]:
    normalized = email.strip().lower()
    return normalized.split("@", 1)[1] if normalized.count("@") == 1 else None


class FraudDAO(FraudDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    async def read_api_key_signals(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        now: datetime,
    ) -> Optional[ApiKeySignals]:
        async with self.engine.session() as session:
            user = (
                await session.execute(select(UserDB).where(UserDB.id == user_id))
            ).scalar_one_or_none()
            project = (
                await session.execute(
                    select(ProjectDB).where(ProjectDB.id == project_id)
                )
            ).scalar_one_or_none()
            if user is None or project is None or project.organization_id is None:
                return None

            owner_id = (
                await session.execute(
                    select(OrganizationDB.owner_id).where(
                        OrganizationDB.id == project.organization_id
                    )
                )
            ).scalar_one_or_none()

            signed_up_at = user.created_at or now
            # Hidden keys are minted by the backend for apps, not by the user.
            first_key_at = (
                await session.execute(
                    select(func.min(APIKeyDB.created_at)).where(
                        APIKeyDB.created_by_id == user_id,
                        APIKeyDB.hidden.is_(False),
                        APIKeyDB.deleted_at.is_(None),
                    )
                )
            ).scalar_one()
            # The key being created now is the first one when none exists yet.
            first_key_at = first_key_at or now

            domain = _domain(user.email or "")
            same_domain_signups = 0
            if domain is not None:
                same_domain_signups = (
                    await session.execute(
                        select(func.count(UserDB.id)).where(
                            func.lower(UserDB.email).endswith(
                                f"@{domain}", autoescape=True
                            ),
                            UserDB.created_at >= now - timedelta(hours=24),
                        )
                    )
                ).scalar_one()

            orgs_owned = (
                await session.execute(
                    select(func.count(OrganizationDB.id)).where(
                        OrganizationDB.owner_id == user_id
                    )
                )
            ).scalar_one()

            return ApiKeySignals(
                organization_id=project.organization_id,
                owns_organization=owner_id is not None and owner_id == user_id,
                email=user.email or "",
                account_age_seconds=max(0, int((now - signed_up_at).total_seconds())),
                first_api_key_seconds_after_signup=max(
                    0, int((first_key_at - signed_up_at).total_seconds())
                ),
                same_domain_signups_24h=int(same_domain_signups or 0),
                orgs_owned=int(orgs_owned or 0),
            )

    async def mark_no_grants(
        self,
        *,
        organization_id: UUID,
        checkpoint: FraudCheckpoint,
        score: float,
        now: datetime,
    ) -> None:
        async with self.engine.session() as session:
            organization = (
                await session.execute(
                    select(OrganizationDB)
                    .where(OrganizationDB.id == organization_id)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if organization is None:
                return
            flags = dict(organization.flags or {})
            flags[NO_GRANTS_FLAG] = True
            flags["fraud_check"] = {
                "checkpoint": checkpoint.value,
                "score": score,
                "at": now.isoformat(),
            }
            organization.flags = flags

    async def grants_blocked(self, *, organization_id: UUID) -> bool:
        async with self.engine.session() as session:
            flags = (
                await session.execute(
                    select(OrganizationDB.flags).where(
                        OrganizationDB.id == organization_id
                    )
                )
            ).scalar_one_or_none()
            return bool(isinstance(flags, dict) and flags.get(NO_GRANTS_FLAG))

    async def read_billing_facts(self, *, organization_id: UUID) -> BillingFacts:
        async with self.engine.session() as session:
            subscription = (
                await session.execute(
                    select(
                        SubscriptionDBE.plan,
                        SubscriptionDBE.customer_id,
                        SubscriptionDBE.subscription_id,
                    ).where(SubscriptionDBE.organization_id == organization_id)
                )
            ).one_or_none()
            # Deleted and expired credits count too: a payment in the past is still a
            # payment.
            paid_credit = (
                await session.execute(
                    select(WalletCreditDBE.id)
                    .where(
                        WalletCreditDBE.organization_id == organization_id,
                        WalletCreditDBE.credit_kind.in_(PAID_CREDIT_KINDS),
                        WalletCreditDBE.amount_musd > 0,
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()

        return BillingFacts(
            plan=subscription.plan if subscription is not None else None,
            has_stripe_ids=bool(
                subscription is not None
                and (subscription.customer_id or subscription.subscription_id)
            ),
            has_paid_credit=paid_credit is not None,
        )
