"""repair workflow revision versions

Revision ID: b3c4d5e6f7a9
Revises: a2b3c4d5e6f8
Create Date: 2026-06-11 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import context

from oss.databases.postgres.migrations.core.data_migrations.workflow_revision_versions import (
    downgrade_workflow_revision_versions,
    upgrade_workflow_revision_versions,
)

# revision identifiers, used by Alembic.
revision: str = "b3c4d5e6f7a9"
down_revision: Union[str, None] = "a2b3c4d5e6f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = context.get_bind()
    upgrade_workflow_revision_versions(session=connection)


def downgrade() -> None:
    connection = context.get_bind()
    downgrade_workflow_revision_versions(session=connection)
