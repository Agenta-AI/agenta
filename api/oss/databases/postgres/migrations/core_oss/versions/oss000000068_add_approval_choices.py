"""add approval choices

`approval_choices` holds one row per person, agent and tool: the person's "always
approve" for that tool of that agent (the builder's `ask` tools). `artifact_id` has no
foreign key, because the builder is served from code and its artifact row may not exist.
Rows are deleted, never archived.

The table is new and empty, so its index is built in the same transaction. The foreign
keys to existing tables take a short lock on them, under a lock timeout.

Revision ID: oss000000068
Revises: oss000000067
Create Date: 2026-11-21 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "oss000000068"
down_revision: Union[str, None] = "oss000000067"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        "approval_choices",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("artifact_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("call_ref", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_approval_choices"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
            name="fk_approval_choices_project_id",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name="fk_approval_choices_user_id",
        ),
        sa.UniqueConstraint(
            "project_id",
            "artifact_id",
            "user_id",
            "call_ref",
            name="uq_approval_choices_project_id_artifact_id_user_id_call_ref",
        ),
        if_not_exists=True,
    )
    op.create_index(
        "ix_approval_choices_user_id",
        "approval_choices",
        ["user_id"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_table("approval_choices", if_exists=True)
