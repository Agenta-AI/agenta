"""rerun the project repair and the one-default consolidation of oss000000053

Step 2b of workspace removal (design.md D5, "stop reading"). During the step 2 rollout,
pods of the release before it (step 1) still served requests. They could write a project
default in a secondary workspace through a workspace-scoped write, so an organization
can hold two `is_default` projects again. Step-2 readers picked one by the D-11 order;
from this release on, readers no longer read `workspaces` or `projects.workspace_id` and
pick the default by `created_at, id` only, so the data must again hold one default per
organization, chosen by the D-11 order.

This revision runs the same two statements as oss000000053, in the same order, with the
same locks (it calls that revision's `switch`):

1. Repair: a project whose workspace belongs to another organization loses that
   workspace (`workspace_id` becomes NULL).
2. Consolidation: in each organization with several `is_default` projects, the first by
   the D-11 order keeps the flag; the others lose it.

Idempotent: on data that oss000000053 left and nobody changed since, it changes nothing.
Every changed project id is printed (ids only). One-way like oss000000053: `downgrade()`
does nothing; restore the pre-release dump of `projects` to undo it. Data only, so the
migration gate reports no finding.

Revision ID: oss000000055
Revises: oss000000053
Create Date: 2026-10-28 00:00:00.000000

"""

import importlib.util
from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = "oss000000055"
down_revision: Union[str, None] = "oss000000053"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STEP_2_REVISION = "oss000000053_switch_projects_to_organization_defaults.py"


def _step_2_revision():
    """oss000000053, loaded from its file (revision files are not a package)."""

    path = Path(__file__).with_name(_STEP_2_REVISION)
    spec = importlib.util.spec_from_file_location("_oss000000053", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute("SET LOCAL statement_timeout = '60s'")
    _step_2_revision().switch(op.get_bind())


def downgrade() -> None:
    """One-way data change, as oss000000053. Restore the pre-release dump of `projects`
    to undo it."""
