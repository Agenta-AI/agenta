"""add session_sequence_cursors.records_incomplete_at

Revision ID: oss000000007
Revises: oss000000006
Create Date: 2026-10-05 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "oss000000007"
down_revision: Union[str, None] = "oss000000006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # When a runner reported that the session's record log lost a record. Set once, never
    # cleared. Nullable with no default, so existing rows read as complete.
    op.add_column(
        "session_sequence_cursors",
        sa.Column("records_incomplete_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("session_sequence_cursors", "records_incomplete_at")
