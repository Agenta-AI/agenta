"""update builtin application workflow revision schemas

Revision ID: e6f7a8b9c0d1
Revises: d3e4f5a6b7c8
Create Date: 2026-05-06 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import context

from oss.databases.postgres.migrations.core.data_migrations.workflow_revision_schemas import (
    downgrade_builtin_application_workflow_revision_schemas,
    upgrade_builtin_application_workflow_revision_schemas,
)

# revision identifiers, used by Alembic.
revision: str = "e6f7a8b9c0d1"
down_revision: Union[str, None] = "d3e4f5a6b7c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = context.get_bind()
    upgrade_builtin_application_workflow_revision_schemas(session=connection)


def downgrade() -> None:
    connection = context.get_bind()
    downgrade_builtin_application_workflow_revision_schemas(session=connection)
