"""add archived_at to session_streams (distinct from deleted_at/kill)

Archive and kill both set `deleted_at`, so the durable list (`include_ended`) can't tell a
killed-but-resumable session from a deliberately-hidden one. This adds a dedicated
`archived_at` so archive is a separate, restorable state: the list hides `archived_at` rows by
default (and never confuses them with killed rows), while `include_archived` surfaces them for an
archived view. Kill / `deleted_at` is untouched.

Revision ID: oss000000018
Revises: oss000000017
Create Date: 2026-07-20 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "oss000000018"
down_revision: Union[str, None] = "oss000000017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "session_streams",
        sa.Column("archived_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("session_streams", "archived_at")
