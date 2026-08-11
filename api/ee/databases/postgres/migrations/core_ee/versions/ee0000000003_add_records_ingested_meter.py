"""add RECORDS_INGESTED to meters_type

Revision ID: ee0000000003
Revises: ee0000000002
Create Date: 2026-06-30 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "ee0000000003"
down_revision: Union[str, None] = "ee0000000002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE meters_type ADD VALUE IF NOT EXISTS 'RECORDS_INGESTED'")


def downgrade() -> None:
    # Postgres cannot drop an enum label; leave RECORDS_INGESTED in place.
    pass
