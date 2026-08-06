"""backfill legacy OSS singleton organization slug

Legacy OSS installations created their default organization before
``organizations.slug`` was populated. Current OSS code expects the singleton
organization to be discoverable as ``oss-default``, so upgraded databases need
that row backfilled once during migration.

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d2
Create Date: 2026-05-30 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import context

from oss.databases.postgres.migrations.core.data_migrations.organizations_slug_backfill import (
    downgrade_organizations_slug_backfill,
    upgrade_organizations_slug_backfill,
)

# revision identifiers, used by Alembic.
revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, None] = "e6f7a8b9c0d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = context.get_bind()
    upgrade_organizations_slug_backfill(session=connection)


def downgrade() -> None:
    connection = context.get_bind()
    downgrade_organizations_slug_backfill(session=connection)
