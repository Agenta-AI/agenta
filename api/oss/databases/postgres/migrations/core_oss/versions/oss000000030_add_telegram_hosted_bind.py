"""add telegram hosted bind tables

Revision ID: oss000000030
Revises: oss000000029
Create Date: 2026-09-09 00:00:00.000000

The hosted (Agenta-owned) Telegram bot is one bot shared by every project, so
an inbound update cannot be keyed on the bot id. These two tables carry the
bind: `channel_telegram_bind_tokens` holds the one-time deep-link code minted at
setup, and `channel_telegram_chat_bindings` holds the durable
`(bot_id, chat_id) -> project, connection` routing fact the shared ingress reads.
Both are looked up without a project, so their unique keys are global, not
project-scoped.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "oss000000030"
down_revision: Union[str, None] = "oss000000029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _lifecycle_columns():
    return [
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
    ]


def upgrade() -> None:
    op.create_table(
        "channel_telegram_bind_tokens",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("connection_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        *_lifecycle_columns(),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token", name="uq_channel_telegram_bind_tokens_token"),
    )

    op.create_table(
        "channel_telegram_chat_bindings",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("bot_id", sa.String(), nullable=False),
        sa.Column("chat_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("connection_id", sa.UUID(as_uuid=True), nullable=False),
        *_lifecycle_columns(),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "bot_id",
            "chat_id",
            name="uq_channel_telegram_chat_bindings_bot_chat",
        ),
    )


def downgrade() -> None:
    op.drop_table("channel_telegram_chat_bindings")
    op.drop_table("channel_telegram_bind_tokens")
