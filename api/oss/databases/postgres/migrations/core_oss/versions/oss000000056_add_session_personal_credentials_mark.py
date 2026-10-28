"""add session_streams.personal_credentials_used_at

The sticky mark of M7: set, under the session row lock, the first time a run of the
session uses a person's own credential. A marked session can never be shared (made
project-visible or given a grant). The mark never clears.

A nullable column with no default: a metadata-only change, under a short lock timeout.
Old code ignores it. The downgrade drops it; a later upgrade starts with no session
marked, so a session that used a personal credential could then be shared.

Revision ID: oss000000056
Revises: oss000000055
Create Date: 2026-10-28 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000056"
down_revision: Union[str, None] = "oss000000055"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(
        "ALTER TABLE session_streams "
        "ADD COLUMN IF NOT EXISTS personal_credentials_used_at TIMESTAMPTZ"
    )


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(
        "ALTER TABLE session_streams DROP COLUMN IF EXISTS personal_credentials_used_at"
    )
