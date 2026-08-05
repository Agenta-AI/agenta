"""transfer user organization to organization members

Revision ID: 770d68410ab0
Revises: 79b9acb137a1
Create Date: 2024-09-08 18:21:27.192472

"""

from typing import Sequence, Union
from alembic import context
from alembic import op


from ee.databases.postgres.migrations.core.data_migrations.export_records import (
    transfer_records_from_user_organization_to_organization_members,
    transfer_records_from_organization_members_to_user_organization,
)


# revision identifiers, used by Alembic.
revision: str = "770d68410ab0"
down_revision: Union[str, None] = "79b9acb137a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = context.get_bind()  # get database connect from alembic context
    transfer_records_from_user_organization_to_organization_members(session=connection)


def downgrade() -> None:
    connection = context.get_bind()  # get database connect from alembic context
    transfer_records_from_organization_members_to_user_organization(session=connection)
    op.drop_table("organization_members")
