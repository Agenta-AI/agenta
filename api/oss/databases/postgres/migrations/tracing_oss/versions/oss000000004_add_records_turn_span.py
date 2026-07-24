"""add_records_turn_span

Revision ID: oss000000004
Revises: oss000000003
Create Date: 2026-07-17 12:16:14.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "oss000000004"
down_revision: Union[str, None] = "oss000000003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Plain columns, no FK (cross-DB: turns/spans live outside the tracing DB). Both
    # nullable and forward-fill only — the tracing DB is never backfilled/data-migrated;
    # existing rows carry no turn key to reconstruct one from, so they stay null.
    op.add_column("records", sa.Column("turn_id", sa.String(), nullable=True))
    # OTel span id: 64-bit / 16 hex chars, NOT a UUID (128-bit / 32 hex). Text, not UUID.
    op.add_column("records", sa.Column("span_id", sa.String(), nullable=True))

    op.create_index(
        "ix_records_project_id_session_id_turn_id",
        "records",
        ["project_id", "session_id", "turn_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_records_project_id_session_id_turn_id", table_name="records")
    op.drop_column("records", "span_id")
    op.drop_column("records", "turn_id")
