"""
memberships_check - one-off operator job for the membership resolver release (M1).

Run it from a checkout of the release branch, with the target database in the
environment (`POSTGRES_URI_CORE`) and `AGENTA_LICENSE` set to the edition:

    cd api
    uv run --no-sync python -m entrypoints.memberships_check --report [--out DIR]
    uv run --no-sync python -m entrypoints.memberships_check --apply
    uv run --no-sync python -m entrypoints.memberships_check --materialize   # EE only

--report    Read only. Writes `report.json` with counts and id lists for the checks
            P1 to P12 per organization (ids only, never emails).
--apply     Before the upgrade. (1) Deletes the newer rows of each duplicate
            (project_id, user_id) group, counted over non-demo rows, and keeps the
            oldest by (created_at, id) (P5). Demo rows are left to `oss000000044`,
            so a demo row never wins a group. (2) EE: adds the project rows that
            members of an organization without the RBAC entitlement need (P2b),
            except for users with a demo row in that organization, and only while
            `oss000000044` has not run. Prints every deleted row with its role.
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

REPAIR_REVISION = "oss000000044"
UNIQUE_INDEX_NAME = "ux_project_members_project_id_user_id"

_ZERO_UUID = UUID(int=0)

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

# The P2b candidates: workspace members with an organization row and no row in a
# project of that workspace, without a demo row in the organization. The RBAC
# entitlement filter runs in Python (a migration cannot read it).
_P2B_CANDIDATES = """
SELECT DISTINCT ON (wm.user_id, p.id)
       p.organization_id, wm.user_id, p.id AS project_id, wm.role
FROM projects p
JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
WHERE p.organization_id = ANY(CAST(:orgs AS uuid[]))
  AND wm.user_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM organization_members om
              WHERE om.organization_id = p.organization_id AND om.user_id = wm.user_id)
  AND NOT EXISTS (SELECT 1 FROM project_members pm
                  WHERE pm.project_id = p.id AND pm.user_id = wm.user_id)
  AND NOT EXISTS (SELECT 1 FROM project_members d
                  JOIN projects dp ON dp.id = d.project_id
                  WHERE dp.organization_id = p.organization_id
                    AND d.user_id = wm.user_id
                    AND d.is_demo IS TRUE)
ORDER BY wm.user_id, p.id, wm.created_at ASC NULLS LAST, wm.id ASC
"""

_P2B_SQL = f"""
SELECT c.organization_id, c.user_id::text || '/' || c.project_id::text AS item
FROM ({_P2B_CANDIDATES}) c
"""

_P2B_INSERT_SQL = f"""
INSERT INTO project_members (id, user_id, project_id, role, created_at, updated_at)
SELECT gen_random_uuid(), c.user_id, c.project_id, c.role, now(), now()
FROM ({_P2B_CANDIDATES}) c
"""

_P3_SQL = """
SELECT p.organization_id, pm.user_id::text || '/' || p.id::text AS item
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
WHERE p.organization_id = ANY(CAST(:orgs AS uuid[]))
  AND EXISTS (SELECT 1 FROM organization_members om
              WHERE om.organization_id = p.organization_id AND om.user_id = pm.user_id)
  AND NOT EXISTS (SELECT 1 FROM workspace_members wm
                  WHERE wm.workspace_id = p.workspace_id AND wm.user_id = pm.user_id)
"""

_P4_SQL = """
SELECT w.organization_id,
       json_build_object(
         'workspace_count', count(*),
         'member_count', (SELECT count(DISTINCT om.user_id) FROM organization_members om
                          WHERE om.organization_id = w.organization_id),
         'project_count', (SELECT count(*) FROM projects p
                           WHERE p.organization_id = w.organization_id)
       )::text AS item
FROM workspaces w
WHERE w.organization_id = ANY(CAST(:orgs AS uuid[]))
GROUP BY w.organization_id
HAVING count(*) > 1
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
      GROUP BY project_id, user_id HAVING count(*) > 1)
ORDER BY pm.project_id, pm.user_id, pm.created_at ASC NULLS LAST, pm.id ASC
"""

_P6_SQL = """
SELECT w.organization_id, om.user_id::text AS item
FROM organization_members om
JOIN workspace_members wm ON wm.user_id = om.user_id
JOIN workspaces w ON w.id = wm.workspace_id AND w.organization_id = om.organization_id
JOIN organizations o ON o.id = w.organization_id
WHERE w.organization_id = ANY(CAST(:orgs AS uuid[]))
  AND om.user_id <> o.owner_id
  AND wm.role IS NOT NULL
  AND om.role IS DISTINCT FROM wm.role
  AND (SELECT count(*) FROM workspaces w2 WHERE w2.organization_id = w.organization_id) = 1
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
SELECT w.organization_id, 'workspace_members:' || wm.id::text
FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
WHERE w.organization_id = ANY(CAST(:orgs AS uuid[])) AND wm.deleted_at IS NOT NULL
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
    ("P2b", _P2B_SQL, "ee"),
    ("P3", _P3_SQL, "ee"),
    ("P4", _P4_SQL, "ee"),
    ("P5", _P5_SQL, "both"),
    ("P6", _P6_SQL, "both"),
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
          AND (CAST(:orgs AS uuid[]) IS NULL OR p.organization_id = ANY(CAST(:orgs AS uuid[])))
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


async def _rbac_enforced(organization_id: UUID) -> bool:
    """The EE RBAC entitlement of one organization (P2b needs organizations without it)."""

    from ee.src.core.access.entitlements.service import (  # noqa: PLC0415
        Flag,
        check_entitlements,
        scope_from,
    )

    check, _, _ = await check_entitlements(
        key=Flag.RBAC,
        scope=scope_from(organization_id=organization_id),
    )
    return bool(check)


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


async def _no_rbac_organizations(organization_ids: Sequence[UUID]) -> List[UUID]:
    result = []
    for organization_id in organization_ids:
        if not await _rbac_enforced(organization_id):
            result.append(organization_id)
    return result


def _item(value: str) -> Any:
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

    async with get_transactions_engine().transaction() as connection:
        async for batch in _organization_batches(connection, organization_ids):
            for check, sql, edition in CHECKS:
                if not _applies(edition):
                    continue
                orgs = batch
                if check == "P2b":
                    orgs = await _no_rbac_organizations(batch)
                    if not orgs:
                        continue
                rows = await connection.execute(text(sql), {"orgs": orgs})
                for organization_id, item in rows:
                    entry = report[check]
                    entry["count"] += 1
                    entry["organizations"].setdefault(str(organization_id), []).append(
                        _item(item)
                    )

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True))

    return report


async def _repair_revision_applied(connection: AsyncConnection) -> bool:
    exists = (
        await connection.execute(
            text("SELECT to_regclass('alembic_version_oss') IS NOT NULL")
        )
    ).scalar()
    if not exists:
        return False
    versions = (
        (await connection.execute(text("SELECT version_num FROM alembic_version_oss")))
        .scalars()
        .all()
    )
    # Revision ids are zero-padded, so string order is chain order.
    return any(version >= REPAIR_REVISION for version in versions)


async def _apply_on(
    connection: AsyncConnection,
    organization_ids: Optional[Sequence[UUID]],
) -> dict:
    deleted = [
        {
            "id": str(row.id),
            "project_id": str(row.project_id),
            "user_id": str(row.user_id),
            "role": row.role,
        }
        for row in await connection.execute(
            text(_DEDUPLICATE_SQL),
            {"orgs": list(organization_ids) if organization_ids is not None else None},
        )
    ]

    added_p2b = 0
    p2b_skipped = False

    if is_ee():
        if await _repair_revision_applied(connection):
            p2b_skipped = True
        else:
            async for batch in _organization_batches(connection, organization_ids):
                orgs = await _no_rbac_organizations(batch)
                if not orgs:
                    continue
                result = await connection.execute(text(_P2B_INSERT_SQL), {"orgs": orgs})
                added_p2b += result.rowcount or 0

    return {
        "deleted_duplicates": deleted,
        "added_p2b": added_p2b,
        "p2b_skipped": p2b_skipped,
    }


async def run_apply(
    *,
    organization_ids: Optional[Sequence[UUID]] = None,
    connection: Optional[AsyncConnection] = None,
) -> dict:
    """Deduplicate project rows (P5), then add the P2b rows (EE).

    `connection` is for tests only: the caller owns its transaction.
    """

    if connection is not None:
        return await _apply_on(connection, organization_ids)

    async with get_transactions_engine().transaction() as own:
        return await _apply_on(own, organization_ids)


async def run_materialize(
    *,
    organization_ids: Optional[Sequence[UUID]] = None,
) -> dict:
    """EE only. Write the effective OSS membership as project rows."""

    inserted = 0
    updated = 0

    engine = get_transactions_engine()

    async with engine.transaction() as connection:
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
                async with engine.transaction() as connection:
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
    mode.add_argument(
        "--apply", action="store_true", help="Fix duplicates (P5) and P2b."
    )
    mode.add_argument(
        "--materialize",
        action="store_true",
        help="EE only: write the OSS membership as project rows.",
    )
    parser.add_argument("--out", type=Path, default=None, help="Report directory.")
    return parser.parse_args(argv)


async def _main(args) -> int:
    if is_ee():
        from ee.src.core.access.entitlements.service import (  # noqa: PLC0415
            bootstrap_entitlements_services,
        )

        bootstrap_entitlements_services()

    try:
        if args.report:
            out_dir = args.out or _default_out_dir()
            report = await run_report(out_dir=out_dir)
            for check, entry in report.items():
                print(f"{check}: {entry['count']}")
            print(f"report: {out_dir / 'report.json'}")
            return 0

        if args.apply:
            result = await run_apply()
            for row in result["deleted_duplicates"]:
                print(
                    "deleted duplicate project row "
                    f"id={row['id']} project_id={row['project_id']} "
                    f"user_id={row['user_id']} role={row['role']}"
                )
            print(f"deleted duplicates: {len(result['deleted_duplicates'])}")
            if result["p2b_skipped"]:
                print(
                    "P2b skipped: oss000000044 has run, so former demo-only users "
                    "can no longer be told apart."
                )
            elif is_ee():
                print(f"P2b rows added: {result['added_p2b']}")
            return 0

        if not is_ee():
            print("--materialize runs only on EE (AGENTA_LICENSE=ee).")
            return 1
        result = await run_materialize()
        print(f"materialize: inserted={result['inserted']} updated={result['updated']}")
        return 0
    finally:
        await get_transactions_engine().close()


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
