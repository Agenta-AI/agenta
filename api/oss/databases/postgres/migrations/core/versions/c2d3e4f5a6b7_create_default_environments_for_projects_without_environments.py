"""create default environments for projects without environments

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a7
Create Date: 2026-02-09 00:20:00.000000

"""

from typing import Sequence, Union

from alembic import context
from oss.databases.postgres.migrations.core.data_migrations.default_environments import (
    run_migration,
)

# revision identifiers, used by Alembic.
revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, None] = "b1c2d3e4f5a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    run_migration(sqlalchemy_url=context.config.get_main_option("sqlalchemy.url"))


def downgrade() -> None:
    pass
