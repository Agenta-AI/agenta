"""Add EVENTS_INGESTED to meters_type

Revision ID: b2c3d4e5f7a8
Revises: a1b2c3d4e5f7
Create Date: 2026-05-19 18:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2c3d4e5f7a8"
down_revision: Union[str, None] = "a1b2c3d4e5f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ENUM_NAME = "meters_type"
TEMP_ENUM_NAME = "meters_type_temp"
TABLE_NAME = "meters"
COLUMN_NAME = "key"

NEW_ENUM_LABELS = (
    "USERS",
    "EVALUATIONS_RUN",
    "TRACES_INGESTED",
    "TRACES_RETRIEVED",
    "CREDITS_CONSUMED",
    "EVENTS_INGESTED",
)

OLD_ENUM_LABELS = (
    "USERS",
    "EVALUATIONS_RUN",
    "TRACES_INGESTED",
    "TRACES_RETRIEVED",
    "CREDITS_CONSUMED",
)


def _replace_enum(labels: tuple[str, ...]) -> None:
    op.execute(
        sa.text(
            f"CREATE TYPE {TEMP_ENUM_NAME} AS ENUM ("
            + ", ".join(f"'{label}'" for label in labels)
            + ")"
        )
    )
    op.execute(
        sa.text(
            f"ALTER TABLE {TABLE_NAME} "
            f"ALTER COLUMN {COLUMN_NAME} TYPE {TEMP_ENUM_NAME} "
            f"USING {COLUMN_NAME}::text::{TEMP_ENUM_NAME}"
        )
    )
    op.execute(sa.text(f"DROP TYPE {ENUM_NAME}"))
    op.execute(sa.text(f"ALTER TYPE {TEMP_ENUM_NAME} RENAME TO {ENUM_NAME}"))


def upgrade() -> None:
    _replace_enum(NEW_ENUM_LABELS)


def downgrade() -> None:
    op.execute(
        sa.text(
            f"DELETE FROM {TABLE_NAME} WHERE {COLUMN_NAME}::text = 'EVENTS_INGESTED'"
        )
    )
    _replace_enum(OLD_ENUM_LABELS)
