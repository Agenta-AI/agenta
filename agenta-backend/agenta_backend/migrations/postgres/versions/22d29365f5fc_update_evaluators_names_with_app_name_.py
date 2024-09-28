"""Update evaluators names with app name as prefix

Revision ID: 22d29365f5fc
Revises: 6cfe239894fb
Create Date: 2024-09-16 11:38:33.886908

"""

from typing import Sequence, Union

from agenta_backend.migrations.postgres.data_migrations.applications import (
    update_evaluators_with_app_name,
)


# revision identifiers, used by Alembic.
revision: str = "22d29365f5fc"
down_revision: Union[str, None] = "6cfe239894fb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### custom command ###
    update_evaluators_with_app_name()
    # ### end custom command ###


def downgrade() -> None:
    # ### custom command ###
    pass
    # ### end custom command ###
