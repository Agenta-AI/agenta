"""Update evaluators names with app name as prefix

Revision ID: ad0987a77380
Revises: 770d68410ab0
Create Date: 2024-09-17 06:32:38.238473

"""

from typing import Sequence, Union

from alembic import context

from ee.databases.postgres.migrations.core.data_migrations.applications import (
    update_evaluators_with_app_name,
)


# revision identifiers, used by Alembic.
revision: str = "ad0987a77380"
down_revision: Union[str, None] = "770d68410ab0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### custom command ###
    connection = context.get_bind()  # get database connect from alembic context
    update_evaluators_with_app_name(session=connection)
    # ### end custom command ###


def downgrade() -> None:
    # ### custom command ###
    pass
    # ### end custom command ###
