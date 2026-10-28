"""
memberships_check - one-off operator job for the membership resolver release (M1).

Run it from a checkout of the release branch, with the target database in the
environment (`POSTGRES_URI_CORE`) and `AGENTA_LICENSE` set to the edition:

    cd api
    uv run --no-sync python -m entrypoints.memberships_check --report [--out DIR]
    uv run --no-sync python -m entrypoints.memberships_check --apply
    uv run --no-sync python -m entrypoints.memberships_check --materialize   # EE only

--report    Read only. Writes `report.json` with counts and id lists for the checks
            P1, P2a, P5 and P7 to P12 per organization (ids only, never emails).
            The checks that read workspace rows (P2b, P3, P4, P6) went with the
            workspace tables (workspace removal step 3).
--apply     Before the upgrade. Deletes the newer rows of each duplicate
            (project_id, user_id) group, counted over non-demo rows, and keeps the
            oldest by (created_at, id) (P5). Demo rows are left to `oss000000044`,
            so a demo row never wins a group. Prints every deleted row with its
            role. Works per batch of 500 organizations, one transaction each.
--materialize
            EE only, after `ee0000000002` on an OSS to EE switch. Writes the
            effective OSS membership as project rows: a row for every (member,
            project of the organization) pair without one, and every existing row
            set to the member's organization role. Pages by 1,000 members per
            statement. Needs the unique index from `oss000000045`.

Every step is idempotent: a second run changes nothing.
"""

import argparse
import asyncio
from contextlib import asynccontextmanager
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

ORGANIZATION_BATCH_SIZE = 500
MEMBER_PAGE_SIZE = 1000

UNIQUE_INDEX_NAME = "ux_project_members_project_id_user_id"

_ZERO_UUID = UUID(int=0)

# The job runs the same statements once per batch or page, through prepared
# statements. After five executions Postgres may switch a statement to a cached
# generic plan, which ignores the batch's organization ids: on the batch that holds
# a very large organization a candidate query then took about 15 minutes
# instead of 0.3 s. Every transaction of the job plans each statement for its own
# parameters. LOCAL ends with the transaction, so a pooled connection keeps nothing.
FORCE_CUSTOM_PLANS_SQL = "SET LOCAL plan_cache_mode = force_custom_plan"


@asynccontextmanager
async def _job_transaction(engine):
    async with engine.transaction() as job_connection:
        await job_connection.execute(text(FORCE_CUSTOM_PLANS_SQL))
        yield job_connection


# Every check returns (organization_id, item) rows for the organizations in :orgs.
# "Oldest" orders by created_at ASC NULLS LAST, id ASC everywhere.

_P1_SQL = """
SELECT o.id AS organization_id, o.owner_id::text AS item
FROM organizations o
WHERE o.id = ANY(CAST(:orgs AS uuid[]))
  AND NOT EXISTS (SELECT 1 FROM organization_members om
                  WHERE om.organization_id = o.id AND om.user_id = o.owner_id)
"""

_P2A_SQL = """
SELECT o.id AS organization_id, p.id::text AS item
FROM projects p JOIN organizations o ON o.id = p.organization_id
WHERE o.id = ANY(CAST(:orgs AS uuid[]))
  AND NOT EXISTS (SELECT 1 FROM project_members pm
                  WHERE pm.project_id = p.id AND pm.user_id = o.owner_id)
"""

_P5_SQL = """
SELECT p.organization_id,
       json_build_object('id', pm.id, 'project_id', pm.project_id,
                         'user_id', pm.user_id, 'role', pm.role,
                         'is_demo', pm.is_demo)::text AS item
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
WHERE p.organization_id = ANY(CAST(:orgs AS uuid[]))
  AND (pm.project_id, pm.user_id) IN (
      SELECT project_id, user_id FROM project_members
      WHERE project_id IS NOT NULL AND user_id IS NOT NULL
      GROUP BY project_id, user_id HAVING count(*) > 1)
ORDER BY pm.project_id, pm.user_id, pm.created_at ASC NULLS LAST, pm.id ASC
"""

_OLDEST_ORGANIZATION_ROWS = """
SELECT DISTINCT ON (organization_id, user_id) organization_id, user_id, role
FROM organization_members
WHERE organization_id = ANY(CAST(:orgs AS uuid[])) AND user_id IS NOT NULL
ORDER BY organization_id, user_id, created_at ASC NULLS LAST, id ASC
"""

_P7_SQL = f"""
SELECT p.organization_id, pm.user_id::text || '/' || p.id::text AS item
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
JOIN ({_OLDEST_ORGANIZATION_ROWS}) m
  ON m.organization_id = p.organization_id AND m.user_id = pm.user_id
WHERE pm.role IS DISTINCT FROM m.role
"""

_P8_SQL = f"""
SELECT p.organization_id, m.user_id::text || '/' || p.id::text AS item
FROM ({_OLDEST_ORGANIZATION_ROWS}) m
JOIN projects p ON p.organization_id = m.organization_id
WHERE NOT EXISTS (SELECT 1 FROM project_members pm
                  WHERE pm.project_id = p.id AND pm.user_id = m.user_id)
"""

_P9_SQL = """
SELECT p.organization_id, pm.user_id::text || '/' || p.id::text AS item
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
WHERE p.organization_id = ANY(CAST(:orgs AS uuid[]))
  AND NOT EXISTS (SELECT 1 FROM organization_members om
                  WHERE om.organization_id = p.organization_id AND om.user_id = pm.user_id)
"""

_P10_SQL = """
SELECT om.organization_id, 'organization_members:' || om.id::text AS item
FROM organization_members om
WHERE om.organization_id = ANY(CAST(:orgs AS uuid[])) AND om.deleted_at IS NOT NULL
UNION ALL
SELECT p.organization_id, 'project_members:' || pm.id::text
FROM project_members pm JOIN projects p ON p.id = pm.project_id
WHERE p.organization_id = ANY(CAST(:orgs AS uuid[])) AND pm.deleted_at IS NOT NULL
"""

_P11_SQL = """
SELECT p.organization_id, pm.id::text AS item
FROM project_members pm JOIN projects p ON p.id = pm.project_id
WHERE p.organization_id = ANY(CAST(:orgs AS uuid[])) AND pm.is_demo IS TRUE
"""

_P12_SQL = """
SELECT organization_id, user_id::text AS item
FROM organization_members
WHERE organization_id = ANY(CAST(:orgs AS uuid[]))
GROUP BY organization_id, user_id
HAVING count(*) > 1
"""

# (check id, SQL, edition): "both", "ee" or "oss".
CHECKS = (
    ("P1", _P1_SQL, "both"),
    ("P2a", _P2A_SQL, "both"),
    ("P5", _P5_SQL, "both"),
    ("P7", _P7_SQL, "oss"),
    ("P8", _P8_SQL, "oss"),
    ("P9", _P9_SQL, "both"),
    ("P10", _P10_SQL, "both"),
    ("P11", _P11_SQL, "both"),
    ("P12", _P12_SQL, "both"),
)

_NEXT_ORGANIZATION_IDS = """
SELECT id FROM organizations WHERE id > :cursor ORDER BY id LIMIT :batch
"""

_DEDUPLICATE_SQL = """
DELETE FROM project_members
WHERE id IN (
    SELECT id FROM (
        SELECT pm.id,
               row_number() OVER (
                   PARTITION BY pm.project_id, pm.user_id
                   ORDER BY pm.created_at ASC NULLS LAST, pm.id ASC
               ) AS position
        FROM project_members pm
        JOIN projects p ON p.id = pm.project_id
        WHERE pm.is_demo IS NOT TRUE
          AND pm.user_id IS NOT NULL
          AND p.organization_id = ANY(CAST(:orgs AS uuid[]))
    ) ranked
    WHERE ranked.position > 1
)
RETURNING id, project_id, user_id, role
"""

_MEMBER_PAGE_SQL = """
SELECT DISTINCT ON (user_id) user_id, role
FROM organization_members
WHERE organization_id = :org AND user_id IS NOT NULL AND user_id > :cursor
ORDER BY user_id, created_at ASC NULLS LAST, id ASC
LIMIT :page
"""

_MATERIALIZE_INSERT_SQL = """
INSERT INTO project_members (id, user_id, project_id, role, created_at, updated_at)
SELECT gen_random_uuid(), m.user_id, p.id, m.role, now(), now()
FROM unnest(CAST(:users AS uuid[]), CAST(:roles AS varchar[])) AS m(user_id, role)
CROSS JOIN projects p
WHERE p.organization_id = :org
ON CONFLICT (project_id, user_id) DO NOTHING
"""

_MATERIALIZE_UPDATE_SQL = """
UPDATE project_members pm
SET role = m.role, updated_at = now()
FROM unnest(CAST(:users AS uuid[]), CAST(:roles AS varchar[])) AS m(user_id, role),
     projects p
WHERE p.organization_id = :org
  AND pm.project_id = p.id
  AND pm.user_id = m.user_id
  AND pm.role IS DISTINCT FROM m.role
"""


def _edition() -> str:
    return "ee" if is_ee() else "oss"


def _applies(edition: str) -> bool:
    return edition == "both" or edition == _edition()


async def _organization_batches(
    connection: AsyncConnection,
    organization_ids: Optional[Sequence[UUID]],
):
    if organization_ids is not None:
        ids = list(organization_ids)
        for start in range(0, len(ids), ORGANIZATION_BATCH_SIZE):
            yield ids[start : start + ORGANIZATION_BATCH_SIZE]
        return

    cursor = _ZERO_UUID
    while True:
        rows = await connection.execute(
            text(_NEXT_ORGANIZATION_IDS),
            {"cursor": cursor, "batch": ORGANIZATION_BATCH_SIZE},
        )
        batch = [row[0] for row in rows]
        if not batch:
            return
        yield batch
        cursor = batch[-1]


def _item(value: Optional[str]) -> Any:
    # A membership row can have a NULL user_id; the item is then NULL too.
    if value is None:
        return None
    if value.startswith("{"):
        return json.loads(value)
    return value


async def run_report(
    *,
    out_dir: Path,
    organization_ids: Optional[Sequence[UUID]] = None,
) -> dict:
    """Read only. Writes `out_dir/report.json` and returns the same dict."""

    report: Dict[str, dict] = {
        check: {"count": 0, "organizations": {}}
        for check, _, edition in CHECKS
        if _applies(edition)
    }

    async with _job_transaction(get_transactions_engine()) as connection:
        async for batch in _organization_batches(connection, organization_ids):
            for check, sql, edition in CHECKS:
                if not _applies(edition):
                    continue
                rows = await connection.execute(text(sql), {"orgs": batch})
                for organization_id, item in rows:
                    entry = report[check]
                    entry["count"] += 1
                    entry["organizations"].setdefault(str(organization_id), []).append(
                        _item(item)
                    )

    # P5 lists every row of each duplicate group; its count is the number of groups.
    if "P5" in report:
        report["P5"]["count"] = len(
            {
                (row["project_id"], row["user_id"])
                for rows in report["P5"]["organizations"].values()
                for row in rows
            }
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True))

    return report


async def _deduplicate(
    connection: AsyncConnection,
    organization_ids: Sequence[UUID],
) -> List[dict]:
    rows = await connection.execute(
        text(_DEDUPLICATE_SQL),
        {"orgs": list(organization_ids)},
    )
    return [
        {
            "id": str(row.id),
            "project_id": str(row.project_id),
            "user_id": str(row.user_id),
            "role": row.role,
        }
        for row in rows
    ]


async def run_apply(
    *,
    organization_ids: Optional[Sequence[UUID]] = None,
    connection: Optional[AsyncConnection] = None,
) -> dict:
    """Deduplicate project rows (P5).

    The deduplication runs per batch of 500 organizations. Without `connection`, each
    batch is its own transaction, so no run holds row locks across the whole
    database.
    `connection` is for tests only: every step then runs on it, and the caller owns
    its transaction.
    """

    engine = get_transactions_engine()

    @asynccontextmanager
    async def _transaction():
        if connection is not None:
            await connection.execute(text(FORCE_CUSTOM_PLANS_SQL))
            yield connection
        else:
            async with _job_transaction(engine) as own:
                yield own

    async with _transaction() as reader:
        batches = [
            batch async for batch in _organization_batches(reader, organization_ids)
        ]

    deleted: List[dict] = []
    for batch in batches:
        async with _transaction() as writer:
            batch_deleted = await _deduplicate(writer, batch)
        for row in batch_deleted:
            # Printed per batch, as soon as the batch commits.
            print(
                "deleted duplicate project row "
                f"id={row['id']} project_id={row['project_id']} "
                f"user_id={row['user_id']} role={row['role']}"
            )
        deleted.extend(batch_deleted)

    return {"deleted_duplicates": deleted}


async def run_materialize(
    *,
    organization_ids: Optional[Sequence[UUID]] = None,
) -> dict:
    """EE only. Write the effective OSS membership as project rows."""

    inserted = 0
    updated = 0

    engine = get_transactions_engine()

    async with _job_transaction(engine) as connection:
        index = (
            await connection.execute(
                text("SELECT to_regclass(:name)"), {"name": UNIQUE_INDEX_NAME}
            )
        ).scalar()
        if index is None:
            print(
                f"The unique index {UNIQUE_INDEX_NAME} is missing. Run the "
                "migrations (oss000000045) first."
            )
            raise SystemExit(1)

        batches = [
            batch async for batch in _organization_batches(connection, organization_ids)
        ]

    for batch in batches:
        for organization_id in batch:
            cursor = _ZERO_UUID
            while True:
                # One transaction per page, so a large organization never holds
                # one long transaction.
                async with _job_transaction(engine) as connection:
                    page = (
                        await connection.execute(
                            text(_MEMBER_PAGE_SQL),
                            {
                                "org": organization_id,
                                "cursor": cursor,
                                "page": MEMBER_PAGE_SIZE,
                            },
                        )
                    ).all()
                    if not page:
                        break
                    params = {
                        "org": organization_id,
                        "users": [row.user_id for row in page],
                        "roles": [row.role for row in page],
                    }
                    result = await connection.execute(
                        text(_MATERIALIZE_INSERT_SQL), params
                    )
                    inserted += result.rowcount or 0
                    result = await connection.execute(
                        text(_MATERIALIZE_UPDATE_SQL), params
                    )
                    updated += result.rowcount or 0
                cursor = page[-1].user_id
                if len(page) < MEMBER_PAGE_SIZE:
                    break

    return {"inserted": inserted, "updated": updated}


def _default_out_dir() -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return Path.home() / "agenta-memberships-check" / stamp


def _parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__.strip().split("\n\n")[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--report", action="store_true", help="Read only; write report.json."
    )
    mode.add_argument("--apply", action="store_true", help="Fix duplicates (P5).")
    mode.add_argument(
        "--materialize",
        action="store_true",
        help="EE only: write the OSS membership as project rows.",
    )
    parser.add_argument("--out", type=Path, default=None, help="Report directory.")
    return parser.parse_args(argv)


async def _main(args) -> int:
    try:
        return await _run_command(args)
    finally:
        await get_transactions_engine().close()


async def _run_command(args) -> int:
    if args.report:
        out_dir = args.out or _default_out_dir()
        report = await run_report(out_dir=out_dir)
        for check, entry in report.items():
            print(f"{check}: {entry['count']}")
        print(f"report: {out_dir / 'report.json'}")
        return 0

    if args.apply:
        result = await run_apply()
        print(f"deleted duplicates: {len(result['deleted_duplicates'])}")
        return 0

    if not is_ee():
        print("--materialize runs only on EE (AGENTA_LICENSE=ee).")
        return 1
    result = await run_materialize()
    print(f"materialize: inserted={result['inserted']} updated={result['updated']}")
    return 0


def main(argv=None) -> int:
    args = _parse_args(argv)
    try:
        return asyncio.run(_main(args))
    except SystemExit as exit_:
        return int(exit_.code or 0)
    except Exception:  # pylint: disable=broad-exception-caught
        log.error("[memberships] check failed", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
