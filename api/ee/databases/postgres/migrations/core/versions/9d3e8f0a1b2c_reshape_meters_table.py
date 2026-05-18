"""reshape meters table for scope+period dimensions

Enum reshape:
  - Drops legacy values `APPLICATIONS` (catalog removed; rows deleted).
  - Renames legacy values via row migration:
      `TRACES`       -> `TRACES_INGESTED`
      `CREDITS`      -> `CREDITS_CONSUMED`
      `EVALUATIONS`  -> `EVALUATIONS_RUN`
  - Adds new values: `TRACES_RETRIEVED`.
  - Keeps `USERS` as-is.
  Final `meters_type` contains exactly:
      ('USERS', 'EVALUATIONS_RUN', 'TRACES_INGESTED', 'TRACES_RETRIEVED', 'CREDITS_CONSUMED')

Schema reshape:
  - Adds `workspace_id`, `project_id`, `user_id`, `day` (all nullable).
  - Adds deterministic `meter_id` UUID, populated via `compute_meter_id`.
  - Drops the legacy composite PK `(organization_id, key, year, month)`
    BEFORE relaxing `year`/`month` to nullable — Postgres refuses to
    drop NOT NULL on a PK column.
  - Relaxes `year`/`month` to nullable (drops the `(0,0)` gauge sentinel).
  - Backfills `meter_id` for every row.
  - Recreates the old PK shape as a non-unique secondary index
    (extended with `day`), then installs the new PK on `(meter_id)`.

Pre-migration sanity (run before applying):
    SELECT count(*) FROM meters WHERE year IS NULL OR month IS NULL;
    SELECT key, count(*) FROM meters GROUP BY key;

Downgrade:
  - Reverses every step above. Old enum values come back (`APPLICATIONS`,
    legacy verb-less `TRACES` / `CREDITS` / `EVALUATIONS`) and the rename
    is reversed.
  - `TRACES_RETRIEVED` rows would block the type narrowing and are deleted
    explicitly before the swap.
  - Rows whose identity depends on `workspace_id` / `project_id` / `user_id`
    / `day` are deleted before the legacy PK is rebuilt — the old schema
    has no representation for finer scopes or daily granularity, so
    several distinct new-shape rows would otherwise collapse onto the
    same legacy-PK tuple and break the rebuild with a duplicate-key
    violation. This delete is lossy by design.

Revision ID: 9d3e8f0a1b2c
Revises: e6f7a8b9c0d1
Create Date: 2026-05-13 00:00:01.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

# revision identifiers, used by Alembic.
revision: str = "9d3e8f0a1b2c"
down_revision: Union[str, None] = "e6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ENUM_NAME = "meters_type"
TEMP_ENUM_NAME = "meters_type_temp"
TABLE_NAME = "meters"
COLUMN_NAME = "key"

# Final set of enum labels written by application code from this revision on.
NEW_ENUM_LABELS = (
    "USERS",
    "EVALUATIONS_RUN",
    "TRACES_INGESTED",
    "TRACES_RETRIEVED",
    "CREDITS_CONSUMED",
)

# Legacy set this migration replaces.
OLD_ENUM_LABELS = (
    "USERS",
    "APPLICATIONS",
    "EVALUATIONS",
    "TRACES",
    "CREDITS",
)


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Drop rows that no longer have a Python catalog entry.
    op.execute(
        sa.text(
            f"DELETE FROM {TABLE_NAME} "
            f"WHERE {COLUMN_NAME}::text IN ('APPLICATIONS', 'applications')"
        )
    )

    # 2. Swap `meters_type` to its final shape with a CASE-based rename.
    #
    # The temp enum contains exactly the labels we want to end up with. The
    # USING clause maps legacy labels to their verb-explicit successors at
    # cast time, so the rename and the type narrowing happen in one shot.
    op.execute(
        sa.text(
            f"CREATE TYPE {TEMP_ENUM_NAME} AS ENUM ("
            + ", ".join(f"'{label}'" for label in NEW_ENUM_LABELS)
            + ")"
        )
    )
    op.execute(
        sa.text(
            f"ALTER TABLE {TABLE_NAME} "
            f"ALTER COLUMN {COLUMN_NAME} TYPE {TEMP_ENUM_NAME} "
            f"USING ("
            f"  CASE {COLUMN_NAME}::text "
            f"    WHEN 'TRACES'       THEN 'TRACES_INGESTED' "
            f"    WHEN 'CREDITS'      THEN 'CREDITS_CONSUMED' "
            f"    WHEN 'EVALUATIONS'  THEN 'EVALUATIONS_RUN' "
            f"    ELSE {COLUMN_NAME}::text "
            f"  END"
            f")::{TEMP_ENUM_NAME}"
        )
    )
    op.execute(sa.text(f"DROP TYPE {ENUM_NAME}"))
    op.execute(sa.text(f"ALTER TYPE {TEMP_ENUM_NAME} RENAME TO {ENUM_NAME}"))

    # 3. Add new scope/period columns (all nullable, no server default).
    op.add_column(
        TABLE_NAME,
        sa.Column("workspace_id", PG_UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        TABLE_NAME,
        sa.Column("project_id", PG_UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        TABLE_NAME,
        sa.Column("user_id", PG_UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        TABLE_NAME,
        sa.Column("day", sa.SmallInteger(), nullable=True),
    )
    op.add_column(
        TABLE_NAME,
        sa.Column("meter_id", PG_UUID(as_uuid=True), nullable=True),
    )

    # 4. Drop the legacy PK before making year/month nullable.
    #
    # PostgreSQL requires every primary-key column to stay NOT NULL, so the
    # legacy composite PK cannot remain in place while we relax the old
    # `(year, month)` gauge sentinel into real NULLs.
    op.drop_constraint("meters_pkey", TABLE_NAME, type_="primary")

    # 5. Relax year/month to nullable; drop the `0` sentinel default.
    op.alter_column(
        TABLE_NAME,
        "year",
        existing_type=sa.SmallInteger(),
        nullable=True,
        server_default=None,
    )
    op.alter_column(
        TABLE_NAME,
        "month",
        existing_type=sa.SmallInteger(),
        nullable=True,
        server_default=None,
    )

    # 5b. Relax `organization_id` to NULL to match the ORM (`ScopeDBA`
    # now declares it nullable). Without this the DB schema and the
    # mapped model drift, and any future caller that inserts an
    # unbound/global-scope meter would fail on a NOT NULL violation.
    op.alter_column(
        TABLE_NAME,
        "organization_id",
        existing_type=PG_UUID(as_uuid=True),
        nullable=True,
    )

    # 6. Promote (0, 0) gauge sentinel to real NULLs.
    op.execute(
        sa.text(
            f"UPDATE {TABLE_NAME} SET year = NULL, month = NULL "
            f"WHERE year = 0 AND month = 0"
        )
    )

    # 7. Backfill meter_id via the canonicalizer.
    #
    # We deliberately import the runtime `compute_meter_id` (and its
    # supporting `MeterScope` / `MeterPeriod` / `Meters` value objects)
    # rather than freezing a copy of the canonicalization rules inside
    # this migration. The trade-off is documented in
    # `docs/designs/extend-meters/proposal.md` under the canonicalizer
    # trust model: the runtime is the *single* source of truth for meter
    # identity. Carrying a duplicate implementation in this migration
    # would re-introduce the exact dual-source-of-truth problem that
    # produced PR-02 (the key-case backfill mismatch). If the canonical
    # form ever needs to change, the change requires a re-backfill
    # migration anyway — at which point both sides move together.
    from ee.src.core.meters.types import (
        compute_meter_id,
        MeterScope,
        MeterPeriod,
        Meters,
    )

    rows = (
        bind.execute(
            sa.text(
                "SELECT organization_id, workspace_id, project_id, user_id, "
                "key::text AS key, year, month, day FROM meters"
            )
        )
        .mappings()
        .all()
    )

    for row in rows:
        # `key::text` returns the Postgres enum LABEL (member name, upper
        # case like `TRACES_INGESTED`). Runtime DAO calls hand the Python
        # enum to `compute_meter_id`, which extracts `.value` (lower case
        # like `traces_ingested`). Normalize the migration-side key to the
        # value form so backfilled rows share an identity with runtime
        # writes for the same logical meter. Without this, every legacy
        # row gets a different `meter_id` than the runtime would produce
        # and duplicate rows appear after deployment.
        key_label = row["key"]
        key_value = Meters[key_label].value  # `TRACES_INGESTED` -> `traces_ingested`

        mid = compute_meter_id(
            scope=MeterScope(
                organization_id=row["organization_id"],
                workspace_id=row["workspace_id"],
                project_id=row["project_id"],
                user_id=row["user_id"],
            ),
            period=MeterPeriod(
                year=row["year"],
                month=row["month"],
                day=row["day"],
            ),
            key=key_value,
        )
        # WHERE still matches on the database label (no cast surprises).
        bind.execute(
            sa.text(
                "UPDATE meters SET meter_id = :mid "
                "WHERE organization_id = :org "
                "AND key::text = :key "
                "AND (year IS NOT DISTINCT FROM :year) "
                "AND (month IS NOT DISTINCT FROM :month)"
            ),
            {
                "mid": mid,
                "org": row["organization_id"],
                "key": key_label,
                "year": row["year"],
                "month": row["month"],
            },
        )

    # 8. Constraint changes: enforce meter_id NOT NULL, install the new PK.
    op.alter_column(
        TABLE_NAME,
        "meter_id",
        existing_type=PG_UUID(as_uuid=True),
        nullable=False,
    )

    # Recreate the old PK shape as a non-unique secondary index — the
    # /billing/usage org-rollup and entitlements soft-check paths depend on
    # it. Includes `day` so finer-grained DAILY counters are also served.
    op.create_index(
        "idx_meters_org_key_period",
        TABLE_NAME,
        ["organization_id", "key", "year", "month", "day"],
        unique=False,
    )

    op.create_primary_key("meters_pkey", TABLE_NAME, ["meter_id"])


def downgrade() -> None:
    # 1. Remove the new PK/index before restoring the legacy shape.
    op.drop_constraint("meters_pkey", TABLE_NAME, type_="primary")
    op.drop_index("idx_meters_org_key_period", table_name=TABLE_NAME)

    # 1b. Delete every row whose identity depends on dimensions the legacy
    # schema does not have. After this PR, multiple rows can legitimately
    # differ only by `workspace_id`/`project_id`/`user_id`/`day` (e.g.
    # `TRACES_RETRIEVED` rows are per-user/per-day). Dropping those
    # columns would collapse them onto the same legacy-PK tuple
    # `(organization_id, key, year, month)` and the legacy PK recreation
    # below would fail with a duplicate-key error. This delete is lossy
    # by design — the old schema has no representation for finer scopes
    # or daily granularity, so there is nothing to preserve.
    op.execute(
        sa.text(
            f"DELETE FROM {TABLE_NAME} WHERE "
            f"workspace_id IS NOT NULL "
            f"OR project_id IS NOT NULL "
            f"OR user_id IS NOT NULL "
            f"OR day IS NOT NULL"
        )
    )

    op.drop_column(TABLE_NAME, "meter_id")
    op.drop_column(TABLE_NAME, "day")
    op.drop_column(TABLE_NAME, "user_id")
    op.drop_column(TABLE_NAME, "project_id")
    op.drop_column(TABLE_NAME, "workspace_id")

    op.execute(sa.text(f"UPDATE {TABLE_NAME} SET year = 0 WHERE year IS NULL"))
    op.execute(sa.text(f"UPDATE {TABLE_NAME} SET month = 0 WHERE month IS NULL"))

    # Restore `organization_id` to NOT NULL before the legacy PK is
    # recreated. Any unbound/global-scope rows are deleted (they cannot
    # roundtrip — the old schema had no representation for them).
    op.execute(sa.text(f"DELETE FROM {TABLE_NAME} WHERE organization_id IS NULL"))
    op.alter_column(
        TABLE_NAME,
        "organization_id",
        existing_type=PG_UUID(as_uuid=True),
        nullable=False,
    )

    op.alter_column(
        TABLE_NAME,
        "year",
        existing_type=sa.SmallInteger(),
        nullable=False,
        server_default="0",
    )
    op.alter_column(
        TABLE_NAME,
        "month",
        existing_type=sa.SmallInteger(),
        nullable=False,
        server_default="0",
    )

    # 2. Reverse the enum reshape while no PK depends on `key`.
    # `TRACES_RETRIEVED` rows would block the type narrowing — drop them
    # explicitly. The other three values map back to their legacy labels via
    # CASE inside the USING clause.
    op.execute(
        sa.text(
            f"DELETE FROM {TABLE_NAME} WHERE {COLUMN_NAME}::text = 'TRACES_RETRIEVED'"
        )
    )

    op.execute(
        sa.text(
            f"CREATE TYPE {TEMP_ENUM_NAME} AS ENUM ("
            + ", ".join(f"'{label}'" for label in OLD_ENUM_LABELS)
            + ")"
        )
    )
    op.execute(
        sa.text(
            f"ALTER TABLE {TABLE_NAME} "
            f"ALTER COLUMN {COLUMN_NAME} TYPE {TEMP_ENUM_NAME} "
            f"USING ("
            f"  CASE {COLUMN_NAME}::text "
            f"    WHEN 'TRACES_INGESTED'  THEN 'TRACES' "
            f"    WHEN 'CREDITS_CONSUMED' THEN 'CREDITS' "
            f"    WHEN 'EVALUATIONS_RUN'  THEN 'EVALUATIONS' "
            f"    ELSE {COLUMN_NAME}::text "
            f"  END"
            f")::{TEMP_ENUM_NAME}"
        )
    )
    op.execute(sa.text(f"DROP TYPE {ENUM_NAME}"))
    op.execute(sa.text(f"ALTER TYPE {TEMP_ENUM_NAME} RENAME TO {ENUM_NAME}"))

    # 3. Recreate the legacy PK after all downgraded column shapes are final.
    op.create_primary_key(
        "meters_pkey",
        TABLE_NAME,
        ["organization_id", "key", "year", "month"],
    )
