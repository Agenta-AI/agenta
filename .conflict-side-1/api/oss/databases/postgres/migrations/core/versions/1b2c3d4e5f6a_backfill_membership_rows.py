"""backfill membership rows for existing OSS deployments

Pre-membership OSS derived belonging implicitly (organizations.owner_id plus
used project invitations). This backfills explicit membership rows so the
membership join works for existing users.

Revision ID: 1b2c3d4e5f6a
Revises: 0a1b2c3d4e5f
Create Date: 2026-06-12 00:00:01.000000

"""

from typing import Sequence, Union

from alembic import context

from oss.databases.postgres.migrations.core.data_migrations.memberships import (
    downgrade_membership_backfill,
    upgrade_membership_backfill,
)

# revision identifiers, used by Alembic.
revision: str = "1b2c3d4e5f6a"
down_revision: Union[str, None] = "0a1b2c3d4e5f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = context.get_bind()
    upgrade_membership_backfill(session=connection)


def downgrade() -> None:
    connection = context.get_bind()
    downgrade_membership_backfill(session=connection)
