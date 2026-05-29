"""backfill stale variant slugs embedded in environment references

Environment revisions embed variant slugs under
references[*].{application_variant,workflow_variant}.slug. Some write paths
stored the bare variant name or the revision slug instead of the variant row's
real slug, which breaks the retrieve consistency check. This joins each ref to
its workflow_variants row by id and rewrites the embedded slug to match.

Revision ID: e6f7a8b9c0d2
Revises: d5e6f7a8b9c0
Create Date: 2026-05-28 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import context

from oss.databases.postgres.migrations.core.data_migrations.environment_reference_slugs import (
    downgrade_environment_reference_slugs,
    upgrade_environment_reference_slugs,
)

# revision identifiers, used by Alembic.
revision: str = "e6f7a8b9c0d2"
down_revision: Union[str, None] = "d5e6f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = context.get_bind()
    upgrade_environment_reference_slugs(session=connection)


def downgrade() -> None:
    connection = context.get_bind()
    downgrade_environment_reference_slugs(session=connection)
