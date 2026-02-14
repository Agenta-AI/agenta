"""workspaces migration to add default project and memberships

Revision ID: 1c2d3e4f5a6b
Revises: 6aafdfc2befb
Create Date: 2024-09-03 08:05:58.870573

"""

from typing import Sequence, Union

from alembic import context

from ee.databases.postgres.migrations.core.data_migrations.workspaces import (
    create_default_project_for_workspaces,
    create_default_project_memberships,
    remove_default_projects_from_workspaces,
)


# revision identifiers, used by Alembic.
revision: str = "1c2d3e4f5a6b"
down_revision: Union[str, None] = "6aafdfc2befb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### custom migration ###
    connection = context.get_bind()  # get database connect from alembic context
    create_default_project_for_workspaces(session=connection)
    create_default_project_memberships(session=connection)
    # ### end custom migration ###


def downgrade() -> None:
    # ### custom migration ###
    connection = context.get_bind()  # get database connect from alembic context
    remove_default_projects_from_workspaces(session=connection)
    # ### end custom migration ###
