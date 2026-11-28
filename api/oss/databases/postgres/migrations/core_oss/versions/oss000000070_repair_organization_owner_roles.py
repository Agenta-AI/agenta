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

Old API pods can transfer ownership during the upgrade. A transfer changes the owner's
member rows and then `organizations.owner_id`. The revision first locks the rows of
the organizations it repairs, and then changes only those organizations, so it never
gives `owner` back to a former owner. A transfer that runs at the same time waits for
the revision, or Postgres ends one of the two with a deadlock error. The deploy then
runs the revision again, or the user retries the transfer.

Old and new API pods both read `owner` the same way. Membership caches expire on their
own (five minutes at most). Idempotent: a rerun finds no row to change.

Revision ID: oss000000070
Revises: oss000000069
Create Date: 2026-11-27 00:00:00.000000
"""

from typing import List, Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "oss000000070"
down_revision: Union[str, None] = "oss000000069"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Row locks, not the per-organization advisory lock of the membership writers: one
# transaction may repair tens of thousands of organizations, more advisory locks than
# the shared lock table holds.
_LOCK_ORGANIZATIONS_TO_REPAIR_SQL = """
SELECT o.id
FROM organizations o
WHERE EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = o.id
          AND om.user_id = o.owner_id
          AND om.role IS DISTINCT FROM 'owner'
      )
   OR EXISTS (
        SELECT 1 FROM project_members pm
        JOIN projects p ON p.id = pm.project_id
        WHERE p.organization_id = o.id
          AND pm.user_id = o.owner_id
          AND pm.role IS DISTINCT FROM 'owner'
      )
ORDER BY o.id
FOR UPDATE OF o
"""

_SET_OWNER_ORGANIZATION_ROLE_SQL = """
UPDATE organization_members om
SET role = 'owner', updated_at = now()
FROM organizations o
WHERE o.id = ANY(CAST(:organization_ids AS uuid[]))
  AND om.organization_id = o.id
  AND om.user_id = o.owner_id
  AND om.role IS DISTINCT FROM 'owner'
"""

_SET_OWNER_PROJECT_ROLE_SQL = """
UPDATE project_members pm
SET role = 'owner', updated_at = now()
FROM projects p
JOIN organizations o ON o.id = p.organization_id
WHERE o.id = ANY(CAST(:organization_ids AS uuid[]))
  AND pm.project_id = p.id
  AND pm.user_id = o.owner_id
  AND pm.role IS DISTINCT FROM 'owner'
"""

REPAIR_STATEMENTS = (
    _SET_OWNER_ORGANIZATION_ROLE_SQL,
    _SET_OWNER_PROJECT_ROLE_SQL,
)


def repair(connection) -> List[int]:
    """Lock the organizations to repair, then repair them. Returns the row count of
    each repair statement."""

    organization_ids: List[str] = [
        str(organization_id)
        for organization_id in connection.execute(
            text(_LOCK_ORGANIZATIONS_TO_REPAIR_SQL)
        ).scalars()
    ]
    if not organization_ids:
        return [0 for _ in REPAIR_STATEMENTS]
    return [
        connection.execute(
            text(statement), {"organization_ids": organization_ids}
        ).rowcount
        for statement in REPAIR_STATEMENTS
    ]


def upgrade() -> None:
    # Bound the wait for the row locks of old pods, as `oss000000044` does. LOCAL ends
    # with this revision's transaction.
    op.execute("SET LOCAL lock_timeout = '5s'")
    repair(op.get_bind())


def downgrade() -> None:
    # The old wrong roles are not kept, and restoring them would take the owners'
    # access away again.
    pass
