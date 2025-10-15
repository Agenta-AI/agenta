"""transfer workspace invitations to project invitations

Revision ID: 79b9acb137a1
Revises: 9b0e1a740b88
Create Date: 2024-09-05 17:16:29.480645

"""

from typing import Sequence, Union

from alembic import context

from ee.databases.postgres.migrations.core.data_migrations.invitations import (
    transfer_invitations_from_old_table_to_new_table,
    revert_invitations_transfer_from_new_table_to_old_table,
)


# revision identifiers, used by Alembic.
revision: str = "79b9acb137a1"
down_revision: Union[str, None] = "9b0e1a740b88"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### custom migration ###
    connection = context.get_bind()  # get database connect from alembic context
    transfer_invitations_from_old_table_to_new_table(session=connection)
    # ### end of custom migration ###


def downgrade() -> None:
    # ### custom migration ###
    connection = context.get_bind()  # get database connect from alembic context
    revert_invitations_transfer_from_new_table_to_old_table(session=connection)
    # ### end of custom migration ###
