"""fold the meter rows that still carry a workspace (rerun of ee0000000007)

Step 2b of workspace removal (design.md D7, meter-scope spec "Re-keying keeps every
count"). During the step 2 rollout, pods of the release before it (step 1) still
counted per-user `TRACES_RETRIEVED` under ids with a workspace part, after
ee0000000007 had moved every such row. Step-2 code never read those rows as current
and bumped them by their stored id. From this release on, code no longer reads
`meters.workspace_id`, so this revision folds those rows into their step-2 ids first.

It runs ee0000000007's `run` unchanged: the same refusals before any write, the same
`meters:report` lock for the whole run, the same keyset walk in batches of 1000, one
statement per batch that adds `value` and `synced` into the row with the new id, each
batch in its own transaction with `lock_timeout = 2s` and `statement_timeout = 60s`.
With no row to fold, it takes no lock and needs no Redis.

Idempotent: a rerun finds no row with a workspace. One-way like ee0000000007:
`downgrade()` does nothing; restore the pre-release dump of `meters` to undo it. Data
only, so the migration gate reports no finding.

Revision ID: ee0000000008
Revises: ee0000000007
Create Date: 2026-10-28 00:00:00.000000
"""

import importlib.util
from pathlib import Path
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "ee0000000008"
down_revision: Union[str, None] = "ee0000000007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STEP_2_REVISION = "ee0000000007_rekey_meters_without_workspace.py"


def _step_2_revision():
    """ee0000000007, loaded from its file (revision files are not a package)."""

    path = Path(__file__).with_name(_STEP_2_REVISION)
    spec = importlib.util.spec_from_file_location("_ee0000000007", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def upgrade() -> None:
    with op.get_context().autocommit_block():
        connection = op.get_bind()
        connection.execute(text("SET lock_timeout = '2s'"))
        connection.execute(text("SET statement_timeout = '60s'"))
        try:
            _step_2_revision().run(connection)
        finally:
            connection.execute(text("RESET lock_timeout"))
            connection.execute(text("RESET statement_timeout"))


def downgrade() -> None:
    """One-way data change, as ee0000000007. Restore the pre-release dump of `meters`
    to undo it."""
