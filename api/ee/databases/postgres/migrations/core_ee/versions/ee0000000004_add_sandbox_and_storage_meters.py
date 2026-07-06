"""add sandbox compute + bytes meters to meters_type

Revision ID: ee0000000004
Revises: ee0000000003
Create Date: 2026-07-02 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "ee0000000004"
down_revision: Union[str, None] = "ee0000000003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TYPE meters_type ADD VALUE IF NOT EXISTS 'SANDBOX_CPU_CORE_SECONDS'"
    )
    op.execute(
        "ALTER TYPE meters_type ADD VALUE IF NOT EXISTS 'SANDBOX_RAM_GIBI_SECONDS'"
    )
    op.execute(
        "ALTER TYPE meters_type ADD VALUE IF NOT EXISTS 'SANDBOX_SSD_GIBI_SECONDS'"
    )
    op.execute(
        "ALTER TYPE meters_type ADD VALUE IF NOT EXISTS 'SANDBOX_GPU_CORE_SECONDS'"
    )
    op.execute("ALTER TYPE meters_type ADD VALUE IF NOT EXISTS 'BYTES'")


def downgrade() -> None:
    # Postgres cannot drop an enum label; leave the values in place.
    pass
