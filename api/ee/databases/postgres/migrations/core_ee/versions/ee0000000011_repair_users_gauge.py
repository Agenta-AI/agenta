"""repair the members gauge that OSS adoption and the admin endpoint left unreadable

`ee0000000002` (OSS adoption) wrote each organization's `USERS` gauge with the legacy
shape: `year = 0`, `month = 0` and a random `meter_id`. Every reader asks for the gauge's
row with no period (`year`, `month` and `day` NULL) and its `compute_meter_id` id, so it
never finds that row: the Usage tab shows "0" members for an organization that has an
owner, and the first member invited after adoption starts a new row at 1.

This revision moves each such row to the shape the readers use: no period and the
`compute_meter_id` id. When the organization already has that row (members invited after
adoption), the two are folded by adding `value` and `synced`, so the count is the
adopted members plus the ones added since. The legacy chain made the same move in
`9d3e8f0a1b2c`, so a database that comes from EE has no such row and nothing changes.

It also gives every organization with no `USERS` row its gauge, counted from its
members. The admin accounts endpoint created organizations and memberships without
moving the gauge until this release, so those organizations read "0" members too.

Idempotent: a rerun finds no row with `year = 0` and no organization without a gauge.
One-way: `downgrade()` does nothing.

Revision ID: ee0000000011
Revises: ee0000000010
Create Date: 2026-11-26 00:00:00.000000
"""

from typing import Optional, Sequence, Union
from uuid import UUID

from alembic import op
from sqlalchemy import text

revision: str = "ee0000000011"
down_revision: Union[str, None] = "ee0000000010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ADOPTED_SQL = """
SELECT meter_id, organization_id
FROM meters
WHERE key = CAST('USERS' AS meters_type)
  AND year = 0 AND month = 0 AND day IS NULL
  AND project_id IS NULL AND user_id IS NULL
  AND (CAST(:orgs AS uuid[]) IS NULL OR organization_id = ANY(CAST(:orgs AS uuid[])))
"""

# Move the rows and fold the ones that land on an id that already exists.
_MOVE_SQL = """
WITH m AS (
    SELECT * FROM unnest(CAST(:old AS uuid[]), CAST(:new AS uuid[])) AS t(old_id, new_id)
), moved AS (
    DELETE FROM meters USING m
    WHERE meters.meter_id = m.old_id AND meters.year = 0 AND meters.month = 0
    RETURNING m.new_id, meters.organization_id, meters.key, meters.value,
              meters.synced, meters.created_at
), agg AS (
    SELECT new_id, organization_id, key,
           sum(value)::bigint AS value, sum(synced)::bigint AS synced,
           min(created_at) AS created_at
    FROM moved
    GROUP BY new_id, organization_id, key
)
INSERT INTO meters (meter_id, organization_id, workspace_id, project_id, user_id, key,
                    year, month, day, value, synced, created_at)
SELECT new_id, organization_id, NULL, NULL, NULL, key, NULL, NULL, NULL,
       value, synced, created_at
FROM agg
ON CONFLICT (meter_id) DO UPDATE
SET value = meters.value + EXCLUDED.value,
    synced = meters.synced + EXCLUDED.synced,
    updated_at = now()
"""


_MISSING_SQL = """
SELECT o.id AS organization_id,
       (SELECT count(*) FROM organization_members m WHERE m.organization_id = o.id)
           AS members
FROM organizations o
WHERE NOT EXISTS (
    SELECT 1 FROM meters mm
    WHERE mm.organization_id = o.id AND mm.key = CAST('USERS' AS meters_type)
)
  AND (CAST(:orgs AS uuid[]) IS NULL OR o.id = ANY(CAST(:orgs AS uuid[])))
"""

_INSERT_SQL = """
INSERT INTO meters (meter_id, organization_id, key, value, synced, created_at)
SELECT t.meter_id, t.organization_id, CAST('USERS' AS meters_type), t.members, 0, now()
FROM unnest(CAST(:ids AS uuid[]), CAST(:orgs AS uuid[]), CAST(:members AS bigint[]))
    AS t(meter_id, organization_id, members)
ON CONFLICT (meter_id) DO NOTHING
"""


def users_gauge_id(organization_id: UUID) -> UUID:
    """The id every reader and writer of the organization's members gauge uses."""

    from ee.src.core.meters.types import (  # noqa: PLC0415
        MeterPeriod,
        MeterScope,
        Meters,
        compute_meter_id,
    )

    return compute_meter_id(
        scope=MeterScope(organization_id=organization_id),
        period=MeterPeriod(),
        key=Meters.USERS.value,
    )


def run(bind, *, organization_ids: Optional[Sequence[UUID]] = None) -> dict:
    """Move every adopted members gauge, then add the missing ones. `organization_ids`
    limits the walk (tests). Returns the rows moved and the rows added."""

    orgs = list(organization_ids) if organization_ids is not None else None

    adopted = bind.execute(text(_ADOPTED_SQL), {"orgs": orgs}).all()
    if adopted:
        bind.execute(
            text(_MOVE_SQL),
            {
                "old": [row.meter_id for row in adopted],
                "new": [users_gauge_id(row.organization_id) for row in adopted],
            },
        )

    missing = bind.execute(text(_MISSING_SQL), {"orgs": orgs}).all()
    if missing:
        bind.execute(
            text(_INSERT_SQL),
            {
                "ids": [users_gauge_id(row.organization_id) for row in missing],
                "orgs": [row.organization_id for row in missing],
                "members": [row.members for row in missing],
            },
        )

    return {"moved": len(adopted), "added": len(missing)}


def upgrade() -> None:
    run(op.get_bind())


def downgrade() -> None:
    pass
