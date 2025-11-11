"""Extend app_type to add SNIPPET

Revision ID: f286e830f0bc
Revises: 3b5f5652f611
Create Date: 2025-01-08 10:24:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f286e830f0bc"
down_revision: Union[str, None] = "3b5f5652f611"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    conn = op.get_bind()

    # 1) Rename the current enum
    op.execute("ALTER TYPE app_type_enum RENAME TO app_type_enum_old")

    # 2) Create the new enum with the extra value
    new_enum = sa.Enum(
        "CHAT_TEMPLATE",
        "COMPLETION_TEMPLATE",
        "CHAT_SERVICE",
        "COMPLETION_SERVICE",
        "CUSTOM",
        "SNIPPET",
        name="app_type_enum",
    )
    new_enum.create(conn, checkfirst=False)

    # 3) Alter the column to use the new enum
    op.execute(
        "ALTER TABLE app_db ALTER COLUMN app_type TYPE app_type_enum USING app_type::text::app_type_enum"
    )

    # 4) Drop the old enum
    op.execute("DROP TYPE app_type_enum_old")


def downgrade():
    conn = op.get_bind()

    # 1) Rename the current enum
    op.execute("ALTER TYPE app_type_enum RENAME TO app_type_enum_old")

    # 2) Recreate the old enum without SNIPPET
    old_enum = sa.Enum(
        "CHAT_TEMPLATE",
        "COMPLETION_TEMPLATE",
        "CHAT_SERVICE",
        "COMPLETION_SERVICE",
        "CUSTOM",
        name="app_type_enum",
    )
    old_enum.create(conn, checkfirst=False)

    # 3) Alter the column to use the old enum
    op.execute(
        "ALTER TABLE app_db ALTER COLUMN app_type TYPE app_type_enum USING app_type::text::app_type_enum"
    )

    # 4) Drop the new enum
    op.execute("DROP TYPE app_type_enum_old")
