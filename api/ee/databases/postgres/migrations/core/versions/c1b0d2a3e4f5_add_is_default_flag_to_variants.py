"""Add is_default flag on variants (workflow/query/testset/environment)

Backfills `flags->>'is_default' = true` on the earliest-created variant
per `(project_id, artifact_id)` that does not already have one, then adds
a partial unique index on `(project_id, artifact_id)` filtered by
`(flags->>'is_default')::boolean IS TRUE`. The index doubles as the
uniqueness constraint and the lookup index for the default-variant pick
in `GitDAO.fetch_variant`. Replaces the deterministic ORDER BY interim
introduced by C1a.

Revision ID: c1b0d2a3e4f5
Revises: c11b3a4d5e6f
Create Date: 2026-05-26 16:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from oss.databases.postgres.migrations.core.data_migrations.is_default_variants import (
    VARIANT_TABLES,
    backfill_sql,
)


revision: str = "c1b0d2a3e4f5"
down_revision: Union[str, None] = "c11b3a4d5e6f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    for table in VARIANT_TABLES:
        conn.execute(sa.text(backfill_sql(table)))
        op.create_index(
            f"ix_{table}_default_per_artifact",
            table,
            ["project_id", "artifact_id"],
            unique=True,
            postgresql_where=sa.text("(flags->>'is_default')::boolean IS TRUE"),
        )


def downgrade() -> None:
    for table in VARIANT_TABLES:
        op.drop_index(
            f"ix_{table}_default_per_artifact",
            table_name=table,
        )
