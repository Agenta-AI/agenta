"""add browser_login kind to secretkind_enum

A browser login is a write-only vault secret that only /browser-profiles reads or writes.

Revision ID: oss000000040
Revises: oss000000039
Create Date: 2026-10-10 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "oss000000040"
down_revision: str | None = "oss000000039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ADD VALUE cannot run inside a transaction block on older Postgres.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'BROWSER_LOGIN'")


def downgrade() -> None:
    # PostgreSQL cannot drop an enum value; the BROWSER_LOGIN label stays.
    pass
