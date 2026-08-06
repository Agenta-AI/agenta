"""add session attachments

Revision ID: oss000000020
Revises: oss000000019
Create Date: 2026-07-31 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "oss000000020"
down_revision: Union[str, None] = "oss000000019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "mounts",
        sa.Column("purpose", sa.String(), nullable=True),
    )
    op.create_table(
        "session_attachments",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("mount_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("media_type", sa.String(), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("idempotency_key", sa.String(), nullable=False),
        sa.Column("content_digest", sa.String(), nullable=False),
        sa.Column("referenced_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "state IN ('pending', 'ready', 'deleting')",
            name="ck_session_attachments_state",
        ),
        sa.CheckConstraint(
            "kind IN ('image', 'audio', 'document', 'other')",
            name="ck_session_attachments_kind",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "mount_id"],
            ["mounts.project_id", "mounts.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint(
            "project_id",
            "session_id",
            "idempotency_key",
            name="uq_session_attachments_idempotency",
        ),
    )
    op.create_index(
        "ix_session_attachments_session_state",
        "session_attachments",
        ["project_id", "session_id", "state"],
    )
    op.create_index(
        "ix_session_attachments_project_mount",
        "session_attachments",
        ["project_id", "mount_id"],
    )
    op.create_index(
        "ix_session_attachments_pending_created",
        "session_attachments",
        ["created_at"],
        postgresql_where=sa.text("state IN ('pending', 'deleting')"),
    )
    op.create_index(
        "ix_session_attachments_ready_unreferenced",
        "session_attachments",
        ["created_at"],
        postgresql_where=sa.text("state = 'ready' AND referenced_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_session_attachments_ready_unreferenced",
        table_name="session_attachments",
    )
    op.drop_index(
        "ix_session_attachments_pending_created",
        table_name="session_attachments",
    )
    op.drop_index(
        "ix_session_attachments_session_state",
        table_name="session_attachments",
    )
    op.drop_index(
        "ix_session_attachments_project_mount",
        table_name="session_attachments",
    )
    op.drop_table("session_attachments")
    op.drop_column("mounts", "purpose")
