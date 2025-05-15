"""Extend app_type
Revision ID: 0f086ebc2f83
Revises: 0f086ebc2f82
Create Date: 2025-01-08 10:24:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0f086ebc2f83"
down_revision: Union[str, None] = "0f086ebc2f82"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    # Define the new enum
    temp_enum = sa.Enum(
        "CHAT_TEMPLATE",
        "COMPLETION_TEMPLATE",
        "CHAT_SERVICE",
        "COMPLETION_SERVICE",
        "CUSTOM",
        name="app_type_enum",
    )
    temp_enum.create(op.get_bind(), checkfirst=True)

    # Update the column to use the new enum
    op.execute(
        "ALTER TABLE app_db ALTER COLUMN app_type TYPE app_type_enum USING app_type::text::app_type_enum"
    )

    # Drop the old enum
    op.execute("DROP TYPE app_enumtype")


def downgrade():
    # Define the old enum
    temp_enum = sa.Enum(
        "CHAT_TEMPLATE",
        "COMPLETION_TEMPLATE",
        "CUSTOM",
        name="app_enumtype",
    )
    temp_enum.create(op.get_bind(), checkfirst=True)

    # Update the column to use the old enum
    op.execute(
        "ALTER TABLE app_db ALTER COLUMN app_type TYPE app_enumtype USING app_type::text::app_enumtype"
    )

    # Drop the new enum
    op.execute("DROP TYPE app_type_enum")
