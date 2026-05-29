"""repair corrupted variant slugs and embedded references slugs

Some workflow_variants.slug values contain whitespace or characters outside
the allowed slug alphabet ([a-zA-Z0-9_.-]), which breaks retrieval/resolution.
The same corrupted slug is embedded in environment_revisions.data under
references[*].application_variant.slug, so this repairs both in sync.

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-05-28 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import context

from oss.databases.postgres.migrations.core.data_migrations.retrieval_slug_corruption import (
    downgrade_retrieval_slug_corruption,
    upgrade_retrieval_slug_corruption,
)

# revision identifiers, used by Alembic.
revision: str = "d5e6f7a8b9c0"
down_revision: Union[str, None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = context.get_bind()
    upgrade_retrieval_slug_corruption(session=connection)


def downgrade() -> None:
    connection = context.get_bind()
    downgrade_retrieval_slug_corruption(session=connection)
