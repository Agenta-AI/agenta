"""update secrets data schema type

Revision ID: 2a91436752f9
Revises: 0f086ebc2f83
Create Date: 2025-02-10 10:38:31.555604

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import context, op

from oss.databases.postgres.migrations.core.data_migrations.secrets import (
    rename_and_update_secrets_data_schema,
    revert_rename_and_update_secrets_data_schema,
)


# revision identifiers, used by Alembic.
revision: str = "2a91436752f9"
down_revision: Union[str, None] = "8b6b3e419759"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands to do data migration for secrets ###
    connection = context.get_bind()

    # Define the new enum
    secret_kinds = sa.Enum("PROVIDER_KEY", "CUSTOM_PROVIDER", name="secretkind_enum")
    secret_kinds.create(bind=connection, checkfirst=True)

    # Update the column to make use of the new enum
    op.execute(
        "ALTER TABLE secrets ALTER COLUMN kind TYPE secretkind_enum USING kind::text::secretkind_enum"
    )

    # Drop the old enum
    op.execute("DROP TYPE IF EXISTS secretkind")

    rename_and_update_secrets_data_schema(session=connection)
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands to do data migration for secrets ###
    connection = context.get_bind()

    # Define the new enum
    secret_kinds = sa.Enum("PROVIDER_KEY", name="secretkind")
    secret_kinds.create(bind=connection, checkfirst=True)

    # Update the column to make use of the new enum
    op.execute(
        "ALTER TABLE secrets ALTER COLUMN kind TYPE secretkind USING kind::text::secretkind"
    )

    # Drop the old enum
    op.execute("DROP TYPE IF EXISTS secretkind_enum")

    revert_rename_and_update_secrets_data_schema(session=connection)
    # ### end Alembic commands ###
