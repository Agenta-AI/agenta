"""update workflow URI format from built-in to builtin

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-01-21 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import context
from ee.databases.postgres.migrations.core.data_migrations.workflow_uri import (
    run_migration,
)

# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    run_migration(sqlalchemy_url=context.config.get_main_option("sqlalchemy.url"))


def downgrade() -> None:
    pass
