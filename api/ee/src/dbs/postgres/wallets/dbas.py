"""Shared column mixins for the wallet DBEs.

`organization_id` is a validated logical owner across every wallet table — never a foreign
key, never cascaded — per `docs/design/wallets-research/v1/entities.md`.
"""

from sqlalchemy import BigInteger, Column, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID

from oss.src.dbs.postgres.shared.dbas import LifecycleDBA


class WalletOrgScopeDBA:
    __abstract__ = True

    organization_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )


class WalletCreditDBA(WalletOrgScopeDBA, LifecycleDBA):
    __abstract__ = True

    id = Column(UUID(as_uuid=True), nullable=False)

    credit_kind = Column(String, nullable=False)
    amount_musd = Column(BigInteger, nullable=False)
    priority = Column(Integer, nullable=False)

    start_time = Column(TIMESTAMP(timezone=True), nullable=True)
    end_time = Column(TIMESTAMP(timezone=True), nullable=True)

    data = Column(JSONB(none_as_null=True), nullable=True)


class WalletDebitDBA(WalletOrgScopeDBA, LifecycleDBA):
    __abstract__ = True

    id = Column(UUID(as_uuid=True), nullable=False)

    debit_kind = Column(String, nullable=False)
    amount_musd = Column(BigInteger, nullable=False)

    wallet_credit_id = Column(UUID(as_uuid=True), nullable=True)

    idempotency_key = Column(String, nullable=False)
    debit_key = Column(String, nullable=False)

    resource_key = Column(String, nullable=False)
    resource_locator = Column(JSONB(none_as_null=True), nullable=True)
    pricing_version = Column(String, nullable=False)

    data = Column(JSONB(none_as_null=True), nullable=True)


class WalletBalanceDBA(WalletOrgScopeDBA, LifecycleDBA):
    __abstract__ = True

    id = Column(UUID(as_uuid=True), nullable=False)

    wallet_credit_id = Column(UUID(as_uuid=True), nullable=True)

    balance_musd = Column(BigInteger, nullable=False)
    floor_musd = Column(BigInteger, nullable=True)
