"""add session_states table

Revision ID: s1e2s3s4i5o6
Revises: park00000000
Create Date: 2026-06-28 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "s1e2s3s4i5o6"
down_revision: Union[str, None] = "park00000000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "session_states",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("sandbox_id", sa.String(), nullable=True),
        sa.Column(
            "data",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column("updated_by_id", sa.UUID(), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint("session_id", name="uq_session_states_session_id"),
        sa.UniqueConstraint(
            "project_id",
            "session_id",
            name="uq_session_states_project_session_id",
        ),
    )

    op.create_index(
        "ix_session_states_project_id",
        "session_states",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        "ix_session_states_project_id_session_id",
        "session_states",
        ["project_id", "session_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_session_states_project_id_session_id", table_name="session_states"
    )
    op.drop_index("ix_session_states_project_id", table_name="session_states")
    op.drop_table("session_states")
