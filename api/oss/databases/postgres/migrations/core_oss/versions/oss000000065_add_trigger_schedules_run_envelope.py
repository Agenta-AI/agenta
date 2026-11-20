"""add the stored run envelope to trigger schedules

Revision ID: oss000000065
Revises: oss000000064
Create Date: 2026-11-20 00:00:00.000000

A schedule that server code creates sends an input into an existing session, and runs
with the authority of the turn that asked for it. That authority is a full run envelope,
stored in a server-owned column that no route reads or writes.

| Object | Change |
| --- | --- |
| trigger_schedules.run_envelope | NEW nullable column (jsonb). NULL for every existing row, so no row changes. |

The flag `flags.is_hidden` lives in the existing `flags` column and needs no change.

Deploy this revision before the code that reads the column. An older API pod does not
read the column.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000065"
down_revision: Union[str, None] = "oss000000064"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # A nullable column with no default changes only the catalog.
    op.execute(
        "ALTER TABLE trigger_schedules ADD COLUMN IF NOT EXISTS run_envelope JSONB NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE trigger_schedules DROP COLUMN IF EXISTS run_envelope")
