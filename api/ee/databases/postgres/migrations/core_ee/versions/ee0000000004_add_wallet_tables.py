"""add wallet_credits, wallet_debits, wallet_balances

Adds the EE core transactional wallet unit described in
`docs/design/wallets-research/v1/entities.md`: immutable `wallet_credits` and
`wallet_debits`, and mutable `wallet_balances` (one general row per organization, one row
per credit). `organization_id` is a validated logical owner on every table — no
organization foreign key, no cascade, ever. The non-null `wallet_credit_id` on
`wallet_debits`/`wallet_balances` is a real restrict/no-delete foreign key to
`wallet_credits`.

Deviation from `docs/design/wallets-research/v1/nodes/wp-1-01-core-wallet/specs.md`: that
document names this revision `ee0000000006` with `down_revision = "ee0000000005"`. Those
two revisions exist only on unmerged draft branches; on this base the `core_ee` head is
`ee0000000003`, so this migration is `ee0000000004` / down_revision `ee0000000003`.

Revision ID: ee0000000004
Revises: ee0000000003
Create Date: 2026-08-14 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ee0000000004"
down_revision: Union[str, None] = "ee0000000003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "wallet_credits",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("credit_kind", sa.String(), nullable=False),
        sa.Column("amount_musd", sa.BigInteger(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("end_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("data", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("amount_musd > 0", name="ck_wallet_credits_amount_positive"),
    )
    # Selection index: candidate per-credit balances are locked in this order —
    # priority, end_time, credit id (the deterministic tiebreak).
    op.create_index(
        "idx_wallet_credits_org_priority_end_id",
        "wallet_credits",
        ["organization_id", "priority", "end_time", "id"],
    )

    op.create_table(
        "wallet_debits",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("debit_kind", sa.String(), nullable=False),
        sa.Column("amount_musd", sa.BigInteger(), nullable=False),
        sa.Column("wallet_credit_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("idempotency_key", sa.String(), nullable=False),
        sa.Column("debit_key", sa.String(), nullable=False),
        sa.Column("resource_key", sa.String(), nullable=False),
        sa.Column(
            "resource_locator", postgresql.JSONB(none_as_null=True), nullable=True
        ),
        sa.Column("pricing_version", sa.String(), nullable=False),
        sa.Column("data", postgresql.JSONB(none_as_null=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("amount_musd > 0", name="ck_wallet_debits_amount_positive"),
        sa.ForeignKeyConstraint(
            ["wallet_credit_id"],
            ["wallet_credits.id"],
            ondelete="RESTRICT",
        ),
        # Final replay guard: one debit row per (organization, posting key + actual
        # funding source). debit_key is always derived from the posting's
        # idempotency_key plus its wallet_credit_id or the literal "deficit" — never a
        # sequence or loop index.
        sa.UniqueConstraint(
            "organization_id",
            "debit_key",
            name="uq_wallet_debits_org_debit_key",
        ),
    )
    op.create_index(
        "idx_wallet_debits_org_idempotency",
        "wallet_debits",
        ["organization_id", "idempotency_key"],
    )

    op.create_table(
        "wallet_balances",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("wallet_credit_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("balance_musd", sa.BigInteger(), nullable=False),
        sa.Column("floor_musd", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "wallet_credit_id IS NULL OR balance_musd >= 0",
            name="ck_wallet_balances_credit_nonnegative",
        ),
        sa.ForeignKeyConstraint(
            ["wallet_credit_id"],
            ["wallet_credits.id"],
            ondelete="RESTRICT",
        ),
    )
    # Exactly one general (organization-wide) balance row per organization.
    op.create_index(
        "uq_wallet_balances_org_general",
        "wallet_balances",
        ["organization_id"],
        unique=True,
        postgresql_where=sa.text("wallet_credit_id IS NULL"),
    )
    # Exactly one balance row per credit.
    op.create_index(
        "uq_wallet_balances_credit",
        "wallet_balances",
        ["wallet_credit_id"],
        unique=True,
        postgresql_where=sa.text("wallet_credit_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_wallet_balances_credit", table_name="wallet_balances")
    op.drop_index("uq_wallet_balances_org_general", table_name="wallet_balances")
    op.drop_table("wallet_balances")

    op.drop_index("idx_wallet_debits_org_idempotency", table_name="wallet_debits")
    op.drop_table("wallet_debits")

    op.drop_index("idx_wallet_credits_org_priority_end_id", table_name="wallet_credits")
    op.drop_table("wallet_credits")
