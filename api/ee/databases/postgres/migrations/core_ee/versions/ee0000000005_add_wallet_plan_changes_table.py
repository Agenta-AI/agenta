"""add wallet_plan_changes idempotency ledger

Schema-only migration for `WalletsDAOInterface.apply_plan_change` (subscription
plan-change proration): a small idempotency ledger, keyed on `(organization_id,
idempotency_key)`, that lets a replayed plan-change webhook be detected even when the
change legitimately wrote no `wallet_credits`/`wallet_debits` row at all (both tables'
`amount_musd > 0` check constraints forbid a zero-amount row, so on today's zero
plan-allowance mapping — see `ee.src.core.wallets.plans` — most plan changes write
nothing else to guard replay by).

This is not itself financial history — `wallet_credits`/`wallet_balances` remain the
authoritative ledger — it is a receipt, analogous to the "core settlement receipt" pattern
discussed (and rejected for the measurement/debit split, for unrelated cross-database
reasons) in `docs/design/wallets-research/v1/entities.md`; here it solves a same-database
idempotency-lookup gap, not a cross-database atomicity gap.

Revision ID: ee0000000005
Revises: ee0000000004
Create Date: 2026-08-14 00:10:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ee0000000005"
down_revision: Union[str, None] = "ee0000000004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "wallet_plan_changes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("idempotency_key", sa.String(), nullable=False),
        sa.Column("outgoing_credit_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("outgoing_debit_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "outgoing_debit_amount_musd",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("incoming_credit_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "incoming_credit_amount_musd",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "idempotency_key",
            name="uq_wallet_plan_changes_org_idempotency",
        ),
        sa.ForeignKeyConstraint(
            ["outgoing_credit_id"],
            ["wallet_credits.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["outgoing_debit_id"],
            ["wallet_debits.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["incoming_credit_id"],
            ["wallet_credits.id"],
            ondelete="RESTRICT",
        ),
    )


def downgrade() -> None:
    op.drop_table("wallet_plan_changes")
