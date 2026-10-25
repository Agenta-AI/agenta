"""repair cross-organization projects and keep one default project per organization

Step 2 of workspace removal (design.md D5). From this release on, projects belong to the
organization only: the code stops writing workspace rows, and every reader picks the
organization's default project by one rule (the D-11 order: the project in the
`default`-type workspace, else in the oldest workspace, else the oldest project). Two data
changes make the existing rows fit that model, in one transaction, in this order:

1. Repair: a project whose workspace belongs to another organization keeps its own
   `organization_id` (CONTRACT section 1) and loses the foreign workspace
   (`workspace_id` becomes NULL). Step-1 pods already serve projects without a workspace.
2. Consolidation: in each organization with several `is_default` projects, the first by
   the D-11 order keeps the flag and the others lose it. An organization with no default
   stays without one.

Locks: the consolidation first takes the per-organization advisory lock that every
step-2 default-project writer takes (`agenta:project_default:<organization_id>`), then
row locks on the default projects of those organizations (`FOR UPDATE`; step-1 writers
take no advisory lock and clear the defaults before they set their target), and only
then ranks, in a new statement. A writer that changed rows before makes this wait for
its commit and the ranking reads its result; a later writer waits for this commit. Only
organizations with several defaults are locked. No schema lock. A step-1 writer that
clears defaults in another row order at the same moment can deadlock with the row locks;
Postgres then aborts one side once (the request fails, or the migration job is retried).

Every changed project id is printed (ids only). The change is one-way: `downgrade()` does
nothing; restore the pre-release dump of `projects` to undo it. The migration gate reports
no finding (data-only statements).

Revision ID: oss000000053
Revises: oss000000052
Create Date: 2026-10-25 00:00:00.000000

"""

from typing import Optional, Sequence, Union
from uuid import UUID

from alembic import op
import sqlalchemy as sa

revision: str = "oss000000053"
down_revision: Union[str, None] = "oss000000052"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# `:orgs` NULL means every organization (the release); tests pass their own organizations.
_SCOPE = (
    "(CAST(:orgs AS uuid[]) IS NULL OR p.organization_id = ANY(CAST(:orgs AS uuid[])))"
)

_REPAIR_SQL = f"""
UPDATE projects p SET workspace_id = NULL
FROM workspaces w
WHERE w.id = p.workspace_id
  AND w.organization_id <> p.organization_id
  AND {_SCOPE}
RETURNING p.id, p.organization_id
"""

_SEVERAL_DEFAULTS_SQL = f"""
SELECT p.organization_id FROM projects p
WHERE p.is_default IS TRUE AND {_SCOPE}
GROUP BY p.organization_id
HAVING count(*) > 1
ORDER BY p.organization_id
"""

# The same key as the step-2 default-project writers (`db_manager`, memberships DAO).
_ADVISORY_LOCKS_SQL = """
SELECT pg_advisory_xact_lock(hashtextextended('agenta:project_default:' || o::text, 0))
FROM unnest(CAST(:orgs AS uuid[])) AS o
"""

# Only the default rows: a step-1 writer clears them first and sets its target after, so
# locking its target too would deadlock with it.
_ROW_LOCKS_SQL = """
SELECT p.id FROM projects p
WHERE p.organization_id = ANY(CAST(:orgs AS uuid[])) AND p.is_default IS TRUE
ORDER BY p.id
FOR UPDATE
"""

_CONSOLIDATE_SQL = """
WITH ranked AS (
    SELECT p.id, row_number() OVER (
        PARTITION BY p.organization_id
        ORDER BY (pw.type IS NOT DISTINCT FROM 'default') DESC,
                 pw.created_at ASC NULLS LAST, pw.id ASC NULLS LAST,
                 p.created_at ASC NULLS LAST, p.id ASC
    ) AS rn
    FROM projects p
    LEFT JOIN workspaces pw ON pw.id = p.workspace_id AND pw.organization_id = p.organization_id
    WHERE p.is_default IS TRUE
      AND p.organization_id = ANY(CAST(:orgs AS uuid[]))
)
UPDATE projects p SET is_default = false
FROM ranked r
WHERE r.id = p.id AND r.rn > 1
RETURNING p.id, p.organization_id
"""


def switch(bind, organization_ids: Optional[Sequence[UUID]] = None) -> dict:
    """Run the repair and the consolidation on `bind` (inside its transaction).

    `organization_ids` limits both changes to those organizations (tests); None means all.
    Returns the counts.
    """

    orgs = sorted(organization_ids) if organization_ids is not None else None

    repaired = bind.execute(sa.text(_REPAIR_SQL), {"orgs": orgs}).fetchall()
    for row in repaired:
        print(f"[053] repaired project {row.id} organization {row.organization_id}")

    several = [
        row.organization_id
        for row in bind.execute(sa.text(_SEVERAL_DEFAULTS_SQL), {"orgs": orgs})
    ]
    cleared = []
    if several:
        bind.execute(sa.text(_ADVISORY_LOCKS_SQL), {"orgs": several}).fetchall()
        bind.execute(sa.text(_ROW_LOCKS_SQL), {"orgs": several}).fetchall()
        cleared = bind.execute(sa.text(_CONSOLIDATE_SQL), {"orgs": several}).fetchall()
    for row in cleared:
        print(
            f"[053] cleared default project {row.id} organization {row.organization_id}"
        )

    counts = {
        "repaired": len(repaired),
        "organizations_with_several_defaults": len(several),
        "cleared": len(cleared),
    }
    print(f"[053] totals {counts}")
    return counts


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute("SET LOCAL statement_timeout = '60s'")
    switch(op.get_bind())


def downgrade() -> None:
    """One-way data change: the old workspace of a repaired project and the cleared
    default flags are not kept. Restore the pre-release dump of `projects` to undo it."""
