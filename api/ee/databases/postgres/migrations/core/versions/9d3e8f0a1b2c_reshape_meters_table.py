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

    # 6. Promote (0, 0) gauge sentinel to real NULLs.
    op.execute(
        sa.text(
            f"UPDATE {TABLE_NAME} SET year = NULL, month = NULL "
            f"WHERE year = 0 AND month = 0"
        )
    )

    # 7. Backfill meter_id via the canonicalizer.
    # Importing here keeps the canonical form in one place — the core types
    # module — and guarantees the migration cannot drift from runtime.
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

    op.drop_column(TABLE_NAME, "meter_id")
    op.drop_column(TABLE_NAME, "day")
    op.drop_column(TABLE_NAME, "user_id")
    op.drop_column(TABLE_NAME, "project_id")
    op.drop_column(TABLE_NAME, "workspace_id")

    op.execute(sa.text(f"UPDATE {TABLE_NAME} SET year = 0 WHERE year IS NULL"))
    op.execute(sa.text(f"UPDATE {TABLE_NAME} SET month = 0 WHERE month IS NULL"))

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
