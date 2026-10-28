"""drop meters.workspace_id

Step 3 of workspace removal (design.md D5, D7). ee0000000007 and ee0000000008 moved every
meter row off the workspace, and step 2b removed the column from the code and the ORM,
so the pods of the previous release (step 2b) serve while this runs and after.

First it runs the fold of ee0000000007 once more (it does nothing and takes no lock when
no row has a workspace, which is the normal case after ee0000000008), so a row that
someone wrote by hand since is folded, not lost. Then it refuses, before the drop, when a
row still has a workspace (the fold refuses a shape it cannot key, and names it). Then it
drops the column. The drop takes an
ACCESS EXCLUSIVE lock on `meters` for a moment; `lock_timeout` is 2 s, so the revision
fails and can be retried rather than queue behind a long transaction.

One-way: the column held only NULLs after ee0000000008, so no count is lost, but the
change is not reversible from the data. Take the dump of `meters` before the release.
`downgrade()` adds the NULL column back (schema only).

Revision ID: ee0000000009
Revises: ee0000000008
Create Date: 2026-10-28 00:00:00.000000
"""

import importlib.util
from pathlib import Path
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


_FOLD_REVISION = "ee0000000007_rekey_meters_without_workspace.py"


class RowWithWorkspace(RuntimeError):
    pass


def _fold_revision():
    """ee0000000007, loaded from its file (revision files are not a package)."""

    path = Path(__file__).with_name(_FOLD_REVISION)
    spec = importlib.util.spec_from_file_location("_ee0000000007", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def refuse_rows_with_a_workspace(bind) -> None:
    if bind.execute(text(_HAS_COLUMN_SQL)).first() is None:
        return
    row = bind.execute(text(_ROW_WITH_WORKSPACE_SQL)).first()
    if row is not None:
        raise RowWithWorkspace(
            f"meter {row.meter_id} still has a workspace after the fold. Fix or "
            "delete it, then rerun. Nothing was dropped."
        )


def upgrade() -> None:
    if op.get_bind().execute(text(_HAS_COLUMN_SQL)).first() is not None:
        with op.get_context().autocommit_block():
            connection = op.get_bind()
            connection.execute(text("SET lock_timeout = '2s'"))
            connection.execute(text("SET statement_timeout = '60s'"))
            try:
                _fold_revision().run(connection)
            finally:
                connection.execute(text("RESET lock_timeout"))
                connection.execute(text("RESET statement_timeout"))
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute("SET LOCAL statement_timeout = '60s'")
    refuse_rows_with_a_workspace(op.get_bind())
    op.execute("ALTER TABLE meters DROP COLUMN IF EXISTS workspace_id")


def downgrade() -> None:
    """Schema only: the NULL column, as before this revision."""

    op.execute("ALTER TABLE meters ADD COLUMN IF NOT EXISTS workspace_id uuid")
