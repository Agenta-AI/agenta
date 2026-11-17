"""relax lifecycle nullability on tracing tables

All six lifecycle columns are fully nullable by convention (see
docs/designs/oss-ee-convergence/db-integrity-audit.md); spans and events
carried NOT NULL on created_at (and spans on created_by_id).

Revision ID: a4b5c6d7e8f9
Revises: f3a4b5c6d7e8
Create Date: 2026-06-12 00:00:05.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a4b5c6d7e8f9"
down_revision: Union[str, None] = "f3a4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LIFECYCLE_COLUMNS = (
    "created_at",
    "updated_at",
    "deleted_at",
    "created_by_id",
    "updated_by_id",
    "deleted_by_id",
)


def upgrade() -> None:
    for table in ("spans", "events"):
        for column in LIFECYCLE_COLUMNS:
            op.execute(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" DROP NOT NULL')


def downgrade() -> None:
    pass
