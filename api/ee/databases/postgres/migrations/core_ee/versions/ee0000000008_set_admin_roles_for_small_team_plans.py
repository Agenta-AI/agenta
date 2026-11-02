"""set admin roles on Hobby and Pro, and on stray owner rows

Roles now apply on every plan. Before, an organization without the RBAC entitlement let
every member pass every project check, whatever role was stored. So:

1. On `cloud_v0_hobby` and `cloud_v0_pro`, every organization member, project member and
   unused invitation whose role is not `owner`, `admin` or `member` (or is null) becomes
   `admin`. Those people keep every project action they had. A migration cannot read
   entitlements, so it names the plans; organizations on any other plan value keep
   their rows.
2. On every plan, an `owner` row of a person who is not `organizations.owner_id`
   becomes `admin`, and so does every unused invitation with role `owner`. An invite
   could name `owner` before; such a row passed every check and the role route could
   not change it. The organization owner's own rows keep `owner`.

Workspace member rows are not read by any decision, so they stay. Membership caches
expire on their own (five minutes at most).

Old and new API pods both work on the migrated rows: old pods ignore the role on these
plans, and `admin` is a role every pod knows. Idempotent: a rerun finds no row to change.

One-way: the old role values are not kept. `downgrade()` does nothing.

Revision ID: ee0000000008
Revises: ee0000000007
Create Date: 2026-10-30 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import bindparam, text

revision: str = "ee0000000008"
down_revision: Union[str, None] = "ee0000000007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SMALL_TEAM_PLANS = ["cloud_v0_hobby", "cloud_v0_pro"]
_KEPT_ROLES = ["owner", "admin", "member"]

_SMALL_TEAM_ORGANIZATIONS = """
SELECT s.organization_id FROM subscriptions s WHERE s.plan IN :plans
"""

_ORGANIZATION_MEMBERS = f"""
UPDATE organization_members om
SET role = 'admin', updated_at = now()
WHERE om.organization_id IN ({_SMALL_TEAM_ORGANIZATIONS})
  AND (om.role IS NULL OR om.role NOT IN :kept)
"""

_PROJECT_MEMBERS = f"""
UPDATE project_members pm
SET role = 'admin', updated_at = now()
FROM projects p
WHERE p.id = pm.project_id
  AND p.organization_id IN ({_SMALL_TEAM_ORGANIZATIONS})
  AND (pm.role IS NULL OR pm.role NOT IN :kept)
"""

_INVITATIONS = f"""
UPDATE project_invitations pi
SET role = 'admin', updated_at = now()
FROM projects p
WHERE p.id = pi.project_id
  AND p.organization_id IN ({_SMALL_TEAM_ORGANIZATIONS})
  AND pi.used IS NOT TRUE
  AND (pi.role IS NULL OR pi.role NOT IN :kept)
"""

_STRAY_ORGANIZATION_OWNERS = """
UPDATE organization_members om
SET role = 'admin', updated_at = now()
FROM organizations o
WHERE o.id = om.organization_id
  AND om.role = 'owner'
  AND om.user_id IS DISTINCT FROM o.owner_id
"""

_STRAY_PROJECT_OWNERS = """
UPDATE project_members pm
SET role = 'admin', updated_at = now()
FROM projects p
JOIN organizations o ON o.id = p.organization_id
WHERE p.id = pm.project_id
  AND pm.role = 'owner'
  AND pm.user_id IS DISTINCT FROM o.owner_id
"""

_OWNER_INVITATIONS = """
UPDATE project_invitations pi
SET role = 'admin', updated_at = now()
WHERE pi.role = 'owner'
  AND pi.used IS NOT TRUE
"""


def upgrade() -> None:
    set_roles(op.get_bind())


def set_roles(connection) -> None:
    params = {"plans": _SMALL_TEAM_PLANS, "kept": _KEPT_ROLES}

    for statement in (_ORGANIZATION_MEMBERS, _PROJECT_MEMBERS, _INVITATIONS):
        connection.execute(
            text(statement).bindparams(
                bindparam("plans", expanding=True),
                bindparam("kept", expanding=True),
            ),
            params,
        )

    for statement in (
        _STRAY_ORGANIZATION_OWNERS,
        _STRAY_PROJECT_OWNERS,
        _OWNER_INVITATIONS,
    ):
        connection.execute(text(statement))


def downgrade() -> None:
    pass
