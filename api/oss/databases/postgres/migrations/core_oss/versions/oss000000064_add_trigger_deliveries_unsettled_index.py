"""add the unsettled trigger deliveries index

The settle pass reads trigger deliveries with no `data.outcome` by `(created_at, id)`. No
index starts with `created_at`, and a settled row should leave the index, so this is a
partial index.

The DROP replaces an invalid index left by an interrupted concurrent build: alembic never
runs a finished revision again, and `IF NOT EXISTS` would keep the invalid one.

Revision ID: oss000000064
Revises: oss000000063
Create Date: 2026-11-05 00:00:01.000000
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000064"
down_revision: Union[str, None] = "oss000000063"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # CONCURRENTLY cannot run inside a transaction.
    with op.get_context().autocommit_block():
        op.execute(
            text(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "ix_trigger_deliveries_unsettled_created_at_id;"
            )
        )
        op.execute(
            text(
                """
                CREATE INDEX CONCURRENTLY
                ix_trigger_deliveries_unsettled_created_at_id
                ON trigger_deliveries (created_at, id)
                WHERE (data->>'outcome') IS NULL
                  AND (status->>'code') IN ('202','400','403','422','500');
                """
            )
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            text(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "ix_trigger_deliveries_unsettled_created_at_id;"
            )
        )
