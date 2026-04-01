"""migrate roles to canonical names

Rename legacy role strings to the canonical six-role set and delete API keys
owned by users whose role does not permit API key access.

Role mapping applied:
    editor             -> developer
    workspace_admin    -> admin
    deployment_manager -> editor

API keys owned by project members with role `viewer` or `evaluator` are deleted
before the rename because those roles are not permitted to hold API keys.

Revision ID: b1c2d3e4f5a6
Revises: f0a1b2c3d4e5
Create Date: 2026-03-27 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import context

from oss.databases.postgres.migrations.core.data_migrations.roles import (
    migrate_roles_to_canonical_names,
    revert_roles_to_legacy_names,
)

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "f0a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = context.get_bind()
    migrate_roles_to_canonical_names(session=connection)


def downgrade() -> None:
    connection = context.get_bind()
    revert_roles_to_legacy_names(session=connection)
