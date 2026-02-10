"""Extend app_type

Revision ID: 863f8ebc200f
Revises: 3b5f5652f611
Create Date: 2025-01-08 10:24:00
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "863f8ebc200f"
down_revision: Union[str, None] = "3b5f5652f611"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The table/column that uses the enum
TABLE = "app_db"
COLUMN = "app_type"
TYPE_NAME = "app_type_enum"
TYPE_TEMP = "app_type_enum_temp"

# Exact labels
ORIGINAL = (
    "CHAT_TEMPLATE",
    "COMPLETION_TEMPLATE",
    "CHAT_SERVICE",
    "COMPLETION_SERVICE",
    "CUSTOM",
)
EXTENDED = ORIGINAL + ("SDK_CUSTOM",)


def _create_enum(name: str, labels: tuple[str, ...]) -> None:
    labels_sql = ",".join(f"'{v}'" for v in labels)
    op.execute(f"CREATE TYPE {name} AS ENUM ({labels_sql})")


def _retype_column(to_type: str) -> None:
    op.execute(
        f"""
        ALTER TABLE {TABLE}
        ALTER COLUMN {COLUMN}
        TYPE {to_type}
        USING {COLUMN}::text::{to_type}
        """
    )


def upgrade():
    # 1) Create the replacement enum with ALL desired values
    _create_enum(TYPE_TEMP, EXTENDED)

    # 2) Point the column to the tmp type
    _retype_column(TYPE_TEMP)

    # 3) Drop old type and rename tmp to the canonical name
    op.execute(f"DROP TYPE {TYPE_NAME}")
    op.execute(f"ALTER TYPE {TYPE_TEMP} RENAME TO {TYPE_NAME}")


def downgrade():
    # 1) Recreate the enum WITHOUT the added values
    _create_enum(TYPE_TEMP, ORIGINAL)

    # 2) Point the column back to the original label set
    _retype_column(TYPE_TEMP)

    # 3) Drop current type and rename tmp back to the canonical name
    op.execute(f"DROP TYPE {TYPE_NAME}")
    op.execute(f"ALTER TYPE {TYPE_TEMP} RENAME TO {TYPE_NAME}")
