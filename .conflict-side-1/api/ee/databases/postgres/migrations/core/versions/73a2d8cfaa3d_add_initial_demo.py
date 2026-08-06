"""add initial demo

Revision ID: 73a2d8cfaa3d
Revises: 73a2d8cfaa3c
Create Date: 2024-12-02 9:00:00

"""

from typing import Sequence, Union

from alembic import context

from ee.databases.postgres.migrations.core.data_migrations.demos import (
    add_users_to_demos,
    remove_users_from_demos,
)

# revision identifiers, used by Alembic.
revision: str = "73a2d8cfaa3d"
down_revision: Union[str, None] = "73a2d8cfaa3c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### custom data migrations ###
    connection = context.get_bind()  # get database connect from alembic context
    add_users_to_demos(session=connection)
    # ### end of custom data commands ###


def downgrade() -> None:
    # ### custom data migrations ###
    connection = context.get_bind()  # get database connect from alembic context
    remove_users_from_demos(session=connection)
    # ### end of custom data commands ###
