"""add account_tombstones

A self-service account deletion removes the user, the owned organizations and the
login. Nothing remembered the email, so the same person could sign up again with the
same address and collect the signup grant and the daily free credits once more.

`account_tombstones` keeps one row per deleted user (self-service and admin paths),
written before the login and the rows go away. It never stores the plain email:
`email_hash` is the hex HMAC-SHA256, keyed by `AGENTA_CRYPT_KEY`, of the
provider-normalized address (lowercased and stripped, a `+tag` suffix dropped, and for
Gmail the dots removed from the local part and `googlemail.com` folded into
`gmail.com`; see `ee.src.core.accounts.types.normalize_email`), and the signup path
compares hashes. Rotating `AGENTA_CRYPT_KEY` orphans the older tombstones. The
row also keeps the deleted organization ids and the credits granted and spent across
them (in micro-dollars, from the wallet tables), for the audit a support request needs.

No foreign keys: every id here points at a row that no longer exists.

Revision ID: ee0000000006
Revises: ee0000000005
Create Date: 2026-10-22 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ee0000000006"
down_revision: Union[str, None] = "ee0000000005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "account_tombstones",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email_hash", sa.String(length=64), nullable=False),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column(
            "organization_ids", postgresql.JSONB(none_as_null=True), nullable=False
        ),
        sa.Column("credits_granted_musd", sa.BigInteger(), nullable=False),
        sa.Column("credits_spent_musd", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # The signup path looks up the newest tombstone of an email hash.
    op.create_index(
        "idx_account_tombstones_email_hash_deleted_at",
        "account_tombstones",
        ["email_hash", "deleted_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_account_tombstones_email_hash_deleted_at",
        table_name="account_tombstones",
    )
    op.drop_table("account_tombstones")
