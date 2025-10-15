"""add evaluation queues

Revision ID: d5d4d6bf738f
Revises: fd77265d65dc
Create Date: 2025-07-10 17:04:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d5d4d6bf738f"
down_revision: Union[str, None] = "fd77265d65dc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "evaluation_queues",
        sa.Column(
            "project_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "deleted_at",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_by_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "updated_by_id",
            sa.UUID(),
            nullable=True,
        ),
        sa.Column(
            "deleted_by_id",
            sa.UUID(),
            nullable=True,
        ),
        sa.Column(
            "flags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
        sa.Column(
            "meta",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
        sa.Column(
            "data",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
        sa.Column(
            "run_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint(
            "project_id",
            "id",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "run_id"],
            ["evaluation_runs.project_id", "evaluation_runs.id"],
            ondelete="CASCADE",
        ),
        sa.Index(
            "ix_evaluation_queues_project_id",
            "project_id",
        ),
        sa.Index(
            "ix_evaluation_queues_run_id",
            "run_id",
        ),
    )


def downgrade() -> None:
    op.drop_table("evaluation_queues")
