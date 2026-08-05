"""add webhook subscription flags

Backfill flags.is_active=true on existing webhook_subscriptions and add a
partial active index. The flags JSONB column already exists on the released
core chain, so this is data-only — no column is added.

Revision ID: oss000000004
Revises: oss000000003
Create Date: 2026-06-21 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "oss000000004"
down_revision: Union[str, None] = "oss000000003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Only backfill rows that have no is_active yet — never overwrite an
    # already-set (e.g. paused) value.
    op.execute(
        "UPDATE webhook_subscriptions "
        "SET flags = jsonb_set(COALESCE(flags, '{}'::jsonb), '{is_active}', 'true'::jsonb, true) "
        "WHERE flags IS NULL OR flags ->> 'is_active' IS NULL"
    )
    op.create_index(
        "ix_webhook_subscriptions_active",
        "webhook_subscriptions",
        ["project_id"],
        unique=False,
        postgresql_where=sa.text(
            "(flags ->> 'is_active') = 'true' AND deleted_at IS NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_webhook_subscriptions_active",
        table_name="webhook_subscriptions",
    )
    # Mirror the upgrade: only strip the is_active=true the backfill added to
    # rows that had no flags. Rows carrying other flags (or is_active=false)
    # predate this migration's intent and keep their state.
    op.execute(
        "UPDATE webhook_subscriptions "
        "SET flags = flags - 'is_active' "
        "WHERE flags = '{\"is_active\": true}'::jsonb"
    )
