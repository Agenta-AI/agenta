"""add CREDITS to meters_type

Revision ID: 79f40f71e912
Revises: 3b5f5652f611
Create Date: 2025-11-03 15:00:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "79f40f71e912"
down_revision: Union[str, None] = "baa02d66a365"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ENUM_NAME = "meters_type"
TEMP_ENUM_NAME = "meters_type_temp"
TABLE_NAME = "meters"
COLUMN_NAME = "key"


def upgrade() -> None:
    # 1) Create temp enum including the new value
    op.execute(
        sa.text(
            f"CREATE TYPE {TEMP_ENUM_NAME} AS ENUM ('USERS','APPLICATIONS','EVALUATIONS','TRACES','CREDITS')"
        )
    )

    # 2) Alter column to use temp enum
    op.execute(
        sa.text(
            f"ALTER TABLE {TABLE_NAME} "
            f"ALTER COLUMN {COLUMN_NAME} TYPE {TEMP_ENUM_NAME} "
            f"USING {COLUMN_NAME}::text::{TEMP_ENUM_NAME}"
        )
    )

    # 3) Drop old enum, then 4) rename temp -> original
    op.execute(sa.text(f"DROP TYPE {ENUM_NAME}"))
    op.execute(sa.text(f"ALTER TYPE {TEMP_ENUM_NAME} RENAME TO {ENUM_NAME}"))


def downgrade() -> None:
    # Ensure downgrade can proceed (rows with CREDITS would block the type change)
    op.execute(
        sa.text(f"DELETE FROM {TABLE_NAME} WHERE {COLUMN_NAME}::text = 'CREDITS'")
    )

    # 1) Create temp enum WITHOUT CREDITS
    op.execute(
        sa.text(
            f"CREATE TYPE {TEMP_ENUM_NAME} AS ENUM ('USERS','APPLICATIONS','EVALUATIONS','TRACES')"
        )
    )

    # 2) Alter column to use temp enum
    op.execute(
        sa.text(
            f"ALTER TABLE {TABLE_NAME} "
            f"ALTER COLUMN {COLUMN_NAME} TYPE {TEMP_ENUM_NAME} "
            f"USING {COLUMN_NAME}::text::{TEMP_ENUM_NAME}"
        )
    )

    # 3) Drop current enum (which includes CREDITS), then 4) rename temp -> original
    op.execute(sa.text(f"DROP TYPE {ENUM_NAME}"))
    op.execute(sa.text(f"ALTER TYPE {TEMP_ENUM_NAME} RENAME TO {ENUM_NAME}"))
