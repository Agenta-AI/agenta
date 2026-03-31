"""migrate roles to canonical names (oss scope: project_invitations only)

Rename legacy role strings in project_invitations to the canonical five-role
set. Tables workspace_members and project_members are EE-only and are handled
by the EE migration.

Role mapping applied:
  editor           -> admin
  workspace_admin  -> admin
  deployment_manager -> manager

Revision ID: b1c2d3e4f5a6
Revises: f0a1b2c3d4e5
Create Date: 2026-03-27 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import context

from oss.databases.postgres.migrations.core.data_migrations.roles import (
    migrate_invitations_to_canonical_names,
    revert_invitations_to_legacy_names,
)

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "f0a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = context.get_bind()
    migrate_invitations_to_canonical_names(session=connection)


def downgrade() -> None:
    connection = context.get_bind()
    revert_invitations_to_legacy_names(session=connection)
