"""add_span_identity_columns

Revision ID: oss000000003
Revises: oss000000002
Create Date: 2026-07-17 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "oss000000003"
down_revision: Union[str, None] = "oss000000002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("spans", sa.Column("session_id", sa.String(), nullable=True))
    op.add_column("spans", sa.Column("user_id", sa.String(), nullable=True))
    op.add_column("spans", sa.Column("agent_id", sa.String(), nullable=True))

    op.create_index(
        "ix_spans_project_id_session_id",
        "spans",
        ["project_id", "session_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_spans_project_id_session_id", table_name="spans")

    op.drop_column("spans", "agent_id")
    op.drop_column("spans", "user_id")
    op.drop_column("spans", "session_id")
