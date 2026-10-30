"""add mcps_oauth_attempts.owner_kind

An MCP sign-in attempt records whose sign-in it writes: the project's (`project`, every
existing row) or the person's who started it (`user`). The callback writes the grant for
the stored owner and never infers it.

The check is added NOT VALID under a short lock timeout, then validated in an autocommit
block. Adding a column with a constant default rewrites no row.

Revision ID: oss000000059
Revises: oss000000058
Create Date: 2026-10-29 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000059"
down_revision: Union[str, None] = "oss000000058"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CHECK = "ck_mcps_oauth_attempts_owner_kind"

_CONSTRAINT_EXISTS_SQL = (
    "SELECT 1 FROM pg_catalog.pg_constraint "
    "WHERE conname = :name AND conrelid = pg_catalog.to_regclass('mcps_oauth_attempts')"
)


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(
        "ALTER TABLE mcps_oauth_attempts "
        "ADD COLUMN IF NOT EXISTS owner_kind VARCHAR NOT NULL DEFAULT 'project'"
    )
    exists = op.get_bind().execute(text(_CONSTRAINT_EXISTS_SQL), {"name": _CHECK})
    if exists.scalar() is None:
        op.execute(
            f"ALTER TABLE mcps_oauth_attempts ADD CONSTRAINT {_CHECK} "
            "CHECK (owner_kind IN ('project', 'user')) NOT VALID"
        )

    with op.get_context().autocommit_block():
        op.execute(f"ALTER TABLE mcps_oauth_attempts VALIDATE CONSTRAINT {_CHECK}")


def downgrade() -> None:
    op.execute(f"ALTER TABLE mcps_oauth_attempts DROP CONSTRAINT IF EXISTS {_CHECK}")
    op.execute("ALTER TABLE mcps_oauth_attempts DROP COLUMN IF EXISTS owner_kind")
