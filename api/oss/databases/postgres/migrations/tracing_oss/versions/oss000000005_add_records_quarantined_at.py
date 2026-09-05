"""add_records_quarantined_at

Revision ID: oss000000005
Revises: oss000000004
Create Date: 2026-09-03 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "oss000000005"
down_revision: Union[str, None] = "oss000000004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # A record that reached ingest for a turn the execution watchdog had already ended.
    # Nullable and forward-fill only, like every other column on this table: the tracing DB
    # is never backfilled, and no existing row can be classified retroactively anyway.
    #
    # No index. Every read that filters on it is already scoped to one project and one
    # session by an existing index, and the column is null on all but a handful of rows.
    op.add_column(
        "records",
        sa.Column("quarantined_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("records", "quarantined_at")
