"""Denormalize parent slugs onto variant and revision rows

Adds `artifact_slug` to variant tables and `artifact_slug` + `variant_slug`
to revision tables across the four git-pattern entity sets (workflow,
query, testset, environment), then backfills the new columns from the
parent tables. Read paths use the denormalized values directly instead of
join loads / secondary IN queries.

Revision ID: c11b3a4d5e6f
Revises: e6f7a8b9c0d1
Create Date: 2026-05-26 17:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from oss.databases.postgres.migrations.core.data_migrations.denormalize_slugs import (
    ENTITIES,
    revision_backfill_sql,
    variant_backfill_sql,
)


revision: str = "c11b3a4d5e6f"
down_revision: Union[str, None] = "e6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    for artifacts, variants, revisions in ENTITIES:
        op.add_column(variants, sa.Column("artifact_slug", sa.String(), nullable=True))
        op.add_column(revisions, sa.Column("artifact_slug", sa.String(), nullable=True))
        op.add_column(revisions, sa.Column("variant_slug", sa.String(), nullable=True))

        conn.execute(
            sa.text(variant_backfill_sql(variants=variants, artifacts=artifacts))
        )
        conn.execute(
            sa.text(revision_backfill_sql(revisions=revisions, variants=variants))
        )


def downgrade() -> None:
    for _artifacts, variants, revisions in ENTITIES:
        op.drop_column(revisions, "variant_slug")
        op.drop_column(revisions, "artifact_slug")
        op.drop_column(variants, "artifact_slug")
