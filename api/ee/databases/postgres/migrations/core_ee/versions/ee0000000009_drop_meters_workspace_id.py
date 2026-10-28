"""drop meters.workspace_id

Step 3 of workspace removal (design.md D5, D7). ee0000000007 and ee0000000008 moved every
meter row off the workspace, and step 2b removed the column from the code and the ORM,
so the pods of the previous release (step 2b) serve while this runs and after.

Refuses, before any change, when a row still has a workspace (ee0000000008 left none; a
row with one would lose part of its identity). Then drops the column. The drop takes an
ACCESS EXCLUSIVE lock on `meters` for a moment; `lock_timeout` is 2 s, so the revision
fails and can be retried rather than queue behind a long transaction.

One-way: the column held only NULLs after ee0000000008, so no count is lost, but the
change is not reversible from the data. Take the dump of `meters` before the release.
`downgrade()` adds the NULL column back (schema only).

Revision ID: ee0000000009
Revises: ee0000000008
Create Date: 2026-10-28 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "ee0000000009"
down_revision: Union[str, None] = "ee0000000008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ROW_WITH_WORKSPACE_SQL = """
SELECT meter_id FROM meters WHERE workspace_id IS NOT NULL LIMIT 1
"""

_HAS_COLUMN_SQL = """
SELECT 1 FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'meters' AND column_name = 'workspace_id'
"""


class RowWithWorkspace(RuntimeError):
    pass


def refuse_rows_with_a_workspace(bind) -> None:
    if bind.execute(text(_HAS_COLUMN_SQL)).first() is None:
        return
    row = bind.execute(text(_ROW_WITH_WORKSPACE_SQL)).first()
    if row is not None:
        raise RowWithWorkspace(
            f"meter {row.meter_id} still has a workspace; run ee0000000008 again "
            "(it folds such rows), then rerun. Nothing was changed."
        )


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute("SET LOCAL statement_timeout = '60s'")
    refuse_rows_with_a_workspace(op.get_bind())
    op.execute("ALTER TABLE meters DROP COLUMN IF EXISTS workspace_id")


def downgrade() -> None:
    """Schema only: the NULL column, as before this revision."""

    op.execute("ALTER TABLE meters ADD COLUMN IF NOT EXISTS workspace_id uuid")
