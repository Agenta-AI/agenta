"""repair owner and demo membership rows for the membership resolver

Revision ID: oss000000044
Revises: oss000000043
Create Date: 2026-10-22 00:00:00.000000

The membership resolver decides "is this user a member of this project, and with which
role" from `organization_members` (OSS) and `project_members` (EE). This revision makes
the rows agree with what today's permission checks allow, in four steps:

1. Delete the demo rows (`project_members.is_demo IS TRUE`). The demo feature is gone.
   This runs first, so a user with a demo row and a real row in one project is no
   longer a duplicate when the next revision adds the unique index.
2. P1: add an `owner` organization row for each organization owner who has none.
3. P2a: add an `owner` project row for the organization owner in every project of the
   organization where the owner has no row. The owner shortcut now runs only for a
   member, so an owner without a row would lose access.
4. P6: copy the workspace role into the organization role, for every member except the
   owner, in organizations with exactly one workspace. Role changes went to the
   workspace and project rows only; the organization role is what OSS now reads.

The inserts use `WHERE NOT EXISTS` because the unique index does not exist yet, and
every statement changes nothing on a second run (idempotent). The old code reads none
of these organization rows for project decisions, so old pods keep their decisions.
Downgrade is a no-op: the rows are valid for the old code, and demo rows do not come
back.
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000044"
down_revision: Union[str, None] = "oss000000043"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_DELETE_DEMO_ROWS_SQL = """
DELETE FROM project_members WHERE is_demo IS TRUE
"""

# P1
_ADD_OWNER_ORGANIZATION_ROWS_SQL = """
INSERT INTO organization_members (id, user_id, organization_id, role, created_at, updated_at)
SELECT gen_random_uuid(), o.owner_id, o.id, 'owner', now(), now()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM organization_members om
                  WHERE om.organization_id = o.id AND om.user_id = o.owner_id)
"""

# P2a
_ADD_OWNER_PROJECT_ROWS_SQL = """
INSERT INTO project_members (id, user_id, project_id, role, created_at, updated_at)
SELECT gen_random_uuid(), o.owner_id, p.id, 'owner', now(), now()
FROM projects p JOIN organizations o ON o.id = p.organization_id
WHERE NOT EXISTS (SELECT 1 FROM project_members pm
                  WHERE pm.project_id = p.id AND pm.user_id = o.owner_id)
"""

# P6
_COPY_WORKSPACE_ROLE_SQL = """
UPDATE organization_members om
SET role = wm.role, updated_at = now()
FROM workspace_members wm
JOIN workspaces w ON w.id = wm.workspace_id
JOIN organizations o ON o.id = w.organization_id
WHERE om.organization_id = w.organization_id
  AND om.user_id = wm.user_id
  AND om.user_id <> o.owner_id
  AND wm.role IS NOT NULL
  AND om.role IS DISTINCT FROM wm.role
  AND (SELECT count(*) FROM workspaces w2 WHERE w2.organization_id = w.organization_id) = 1
  AND (SELECT count(*) FROM workspace_members wm2
       WHERE wm2.workspace_id = w.id AND wm2.user_id = wm.user_id) = 1
"""

REPAIR_STATEMENTS = (
    _DELETE_DEMO_ROWS_SQL,
    _ADD_OWNER_ORGANIZATION_ROWS_SQL,
    _ADD_OWNER_PROJECT_ROWS_SQL,
    _COPY_WORKSPACE_ROLE_SQL,
)


def upgrade() -> None:
    for statement in REPAIR_STATEMENTS:
        op.execute(text(statement))


def downgrade() -> None:
    pass
