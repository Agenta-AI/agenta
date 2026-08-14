from sqlalchemy import (
    CheckConstraint,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    UniqueConstraint,
    text,
)

from oss.src.dbs.postgres.shared.base import Base
from ee.src.dbs.postgres.wallets.dbas import (
    WalletBalanceDBA,
    WalletCreditDBA,
    WalletDebitDBA,
    WalletPlanChangeDBA,
)


class WalletCreditDBE(Base, WalletCreditDBA):
    __tablename__ = "wallet_credits"

    __table_args__ = (
        PrimaryKeyConstraint("id"),
        CheckConstraint("amount_musd > 0", name="ck_wallet_credits_amount_positive"),
        # Ordering path for settlement's candidate-credit selection: priority,
        # end_time, then credit id (the tiebreak) — see the replay invariant in
        # docs/design/wallets-research/v1/wave-1.md.
        Index(
            "idx_wallet_credits_org_priority_end_id",
            "organization_id",
            "priority",
            "end_time",
            "id",
        ),
    )


class WalletDebitDBE(Base, WalletDebitDBA):
    __tablename__ = "wallet_debits"

    __table_args__ = (
        PrimaryKeyConstraint("id"),
        CheckConstraint("amount_musd > 0", name="ck_wallet_debits_amount_positive"),
        ForeignKeyConstraint(
            ["wallet_credit_id"],
            ["wallet_credits.id"],
            ondelete="RESTRICT",
        ),
        # Final replay guard: one debit row per (organization, posting key +
        # actual funding source). Never a sequence/loop index.
        UniqueConstraint(
            "organization_id",
            "debit_key",
            name="uq_wallet_debits_org_debit_key",
        ),
        # Fast idempotency-check path: "has this posting already settled?"
        Index(
            "idx_wallet_debits_org_idempotency",
            "organization_id",
            "idempotency_key",
        ),
    )


class WalletBalanceDBE(Base, WalletBalanceDBA):
    __tablename__ = "wallet_balances"

    __table_args__ = (
        PrimaryKeyConstraint("id"),
        CheckConstraint(
            "wallet_credit_id IS NULL OR balance_musd >= 0",
            name="ck_wallet_balances_credit_nonnegative",
        ),
        ForeignKeyConstraint(
            ["wallet_credit_id"],
            ["wallet_credits.id"],
            ondelete="RESTRICT",
        ),
        # Exactly one general (organization-wide) balance row per organization.
        Index(
            "uq_wallet_balances_org_general",
            "organization_id",
            unique=True,
            postgresql_where=text("wallet_credit_id IS NULL"),
        ),
        # Exactly one balance row per credit.
        Index(
            "uq_wallet_balances_credit",
            "wallet_credit_id",
            unique=True,
            postgresql_where=text("wallet_credit_id IS NOT NULL"),
        ),
    )


class WalletPlanChangeDBE(Base, WalletPlanChangeDBA):
    __tablename__ = "wallet_plan_changes"

    __table_args__ = (
        PrimaryKeyConstraint("id"),
        # The replay guard `apply_plan_change` checks first, before any other write.
        UniqueConstraint(
            "organization_id",
            "idempotency_key",
            name="uq_wallet_plan_changes_org_idempotency",
        ),
        ForeignKeyConstraint(
            ["outgoing_credit_id"],
            ["wallet_credits.id"],
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["outgoing_debit_id"],
            ["wallet_debits.id"],
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["incoming_credit_id"],
            ["wallet_credits.id"],
            ondelete="RESTRICT",
        ),
    )
