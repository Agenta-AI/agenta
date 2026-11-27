"""repair organization owner roles

An organization owner (`organizations.owner_id`) must have role `owner` on its
organization row and on its project rows. Some open source databases kept an owner's
organization row at `viewer`. The v0.131.1 membership step copied that role onto every
project row of the organization, so those owners became viewers on every project.

1. Every organization row of an organization's owner gets role `owner`.
2. Every existing project row of that owner, in a project of the organization, gets
   role `owner`.

No row is added. Only the organization owner is changed: a workspace owner who is not
the organization owner keeps its rows. The statements are correct on every edition, as
the organization owner is `owner` on open source and EE alike (see `ee0000000008`).

Old and new API pods both read `owner` the same way. Membership caches expire on their
own (five minutes at most). Idempotent: a rerun finds no row to change.

Revision ID: oss000000070
Revises: oss000000069
Create Date: 2026-11-27 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000070"
down_revision: Union[str, None] = "oss000000069"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SET_OWNER_ORGANIZATION_ROLE_SQL = """
UPDATE organization_members om
SET role = 'owner', updated_at = now()
FROM organizations o
WHERE om.organization_id = o.id
  AND om.user_id = o.owner_id
  AND om.role IS DISTINCT FROM 'owner'
"""

_SET_OWNER_PROJECT_ROLE_SQL = """
UPDATE project_members pm
SET role = 'owner', updated_at = now()
FROM projects p
JOIN organizations o ON o.id = p.organization_id
WHERE pm.project_id = p.id
  AND pm.user_id = o.owner_id
  AND pm.role IS DISTINCT FROM 'owner'
"""

REPAIR_STATEMENTS = (
    _SET_OWNER_ORGANIZATION_ROLE_SQL,
    _SET_OWNER_PROJECT_ROLE_SQL,
)


def upgrade() -> None:
    # Old pods write these tables during the upgrade; bound the wait for their row
    # locks, as `oss000000044` does. LOCAL ends with this revision's transaction.
    op.execute("SET LOCAL lock_timeout = '5s'")
    for statement in REPAIR_STATEMENTS:
        op.execute(text(statement))


def downgrade() -> None:
    # The old wrong roles are not kept, and restoring them would take the owners'
    # access away again.
    pass
