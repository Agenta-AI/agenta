#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "psycopg[binary]>=3.2",
# ]
# ///
"""Rewrite committed agent platform-op keys in workflow revisions.

Hard-migrates workflow_revisions.data at covered tool paths:
    data.parameters.agent.tools[*].op
    data.parameters.tools[*].op
    data.parameters.prompt.llm_config.tools[*].op
    data.parameters.prompt.tools[*].op

Renames:
    find_capabilities -> discover_tools
    find_triggers -> discover_triggers

Usage:
    uv run --script docs/design/agent-workflows/projects/build-kit-tools-cleanup/scripts/sweep_platform_op_renames.py

By default the script is a dry run and reads POSTGRES_URI_CORE, falling back to
DATABASE_URL. Use --database-url to point it at a specific dev DB, --project-id to
limit the sweep, and --apply to commit updates.
"""

from __future__ import annotations

import argparse
import json
import os
from copy import deepcopy
from typing import Any

import psycopg
from psycopg.types.json import Json

RENAMES = {
    "find_capabilities": "discover_tools",
    "find_triggers": "discover_triggers",
}

_TOOL_PATHS = (
    ("parameters.agent.tools", ("parameters", "agent", "tools")),
    ("parameters.tools", ("parameters", "tools")),
    (
        "parameters.prompt.llm_config.tools",
        ("parameters", "prompt", "llm_config", "tools"),
    ),
    ("parameters.prompt.tools", ("parameters", "prompt", "tools")),
)


def _sync_psycopg_url(url: str) -> str:
    return (
        url.replace("postgresql+asyncpg://", "postgresql://", 1)
        .replace("postgres+asyncpg://", "postgresql://", 1)
        .replace("postgres://", "postgresql://", 1)
    )


def _json_data(value: Any) -> Any:
    if isinstance(value, str):
        return json.loads(value)
    return value


def _get_path(data: Any, keys: tuple[str, ...]) -> Any:
    node = data
    for key in keys:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def _tool_collections(data: Any) -> list[tuple[str, tuple[str, ...], list[Any]]]:
    collections: list[tuple[str, tuple[str, ...], list[Any]]] = []
    for path, keys in _TOOL_PATHS:
        tools = _get_path(data, keys)
        if isinstance(tools, list):
            collections.append((path, keys, tools))
    return collections


def old_op_paths(data: Any) -> list[tuple[str, int, str]]:
    paths: list[tuple[str, int, str]] = []
    for path, _keys, tools in _tool_collections(data):
        for index, tool in enumerate(tools):
            if isinstance(tool, dict) and tool.get("op") in RENAMES:
                paths.append((path, index, str(tool["op"])))
    return paths


def rewrite_ops(data: Any) -> tuple[Any, list[tuple[str, int, str, str]]]:
    changes: list[tuple[str, int, str, str]] = []
    for path, _keys, tools in _tool_collections(data):
        for index, tool in enumerate(tools):
            if isinstance(tool, dict) and tool.get("op") in RENAMES:
                changes.append((path, index, str(tool["op"]), RENAMES[str(tool["op"])]))

    if not changes:
        return data, []

    rewritten = deepcopy(data)
    for path, keys in _TOOL_PATHS:
        rewritten_tools = _get_path(rewritten, keys)
        if not isinstance(rewritten_tools, list):
            continue
        for change_path, index, _old, new in changes:
            if change_path == path and isinstance(rewritten_tools[index], dict):
                rewritten_tools[index]["op"] = new
    return rewritten, changes


def _select_candidates(
    conn: psycopg.Connection[Any], project_id: str | None
) -> list[tuple[str, str, Any]]:
    where = [
        "data IS NOT NULL",
        "(data::text LIKE %(find_capabilities)s OR data::text LIKE %(find_triggers)s)",
    ]
    params: dict[str, Any] = {
        "find_capabilities": "%find_capabilities%",
        "find_triggers": "%find_triggers%",
    }
    if project_id is not None:
        where.append("project_id = %(project_id)s::uuid")
        params["project_id"] = project_id

    query = f"""
        SELECT project_id::text, id::text, data
        FROM workflow_revisions
        WHERE {" AND ".join(where)}
        ORDER BY project_id, id
    """
    with conn.cursor() as cur:
        cur.execute(query, params)
        return [(row[0], row[1], _json_data(row[2])) for row in cur.fetchall()]


def sweep(
    conn: psycopg.Connection[Any], *, project_id: str | None, dry_run: bool
) -> int:
    updated_revisions = 0
    updated_tools = 0

    for row_project_id, revision_id, data in _select_candidates(conn, project_id):
        rewritten, changes = rewrite_ops(data)
        if not changes:
            print(
                f"{row_project_id}/{revision_id}: "
                "matched but not rewritten (uncovered path)"
            )
            continue

        updated_revisions += 1
        updated_tools += len(changes)
        for path, index, old, new in changes:
            print(f"{row_project_id}/{revision_id}: {path}[{index}].op {old} -> {new}")

        if not dry_run:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE workflow_revisions
                    SET data = %(data)s
                    WHERE project_id = %(project_id)s::uuid
                      AND id = %(revision_id)s::uuid
                    """,
                    {
                        "data": Json(rewritten),
                        "project_id": row_project_id,
                        "revision_id": revision_id,
                    },
                )

    if dry_run:
        conn.rollback()
        print(
            f"Dry run: would update {updated_tools} tool op reference(s) "
            f"across {updated_revisions} workflow revision(s)."
        )
        return updated_tools

    conn.commit()
    print(
        f"Updated {updated_tools} tool op reference(s) "
        f"across {updated_revisions} workflow revision(s)."
    )
    return updated_tools


def assert_clean(conn: psycopg.Connection[Any], *, project_id: str | None) -> None:
    leftovers: list[str] = []
    uncovered: list[str] = []
    for row_project_id, revision_id, data in _select_candidates(conn, project_id):
        paths = old_op_paths(data)
        if paths:
            for path, index, old in paths:
                leftovers.append(
                    f"{row_project_id}/{revision_id}: {path}[{index}].op = {old}"
                )
        else:
            uncovered.append(
                f"{row_project_id}/{revision_id}: "
                "matched but not rewritten (uncovered path)"
            )

    if leftovers:
        details = "\n".join(leftovers[:20])
        more = "" if len(leftovers) <= 20 else f"\n... and {len(leftovers) - 20} more"
        raise SystemExit(
            f"Sweep incomplete; old platform op keys remain:\n{details}{more}"
        )

    if uncovered:
        details = "\n".join(uncovered[:20])
        more = "" if len(uncovered) <= 20 else f"\n... and {len(uncovered) - 20} more"
        print(details + more)
        raise SystemExit(
            "Sweep incomplete; LIKE-matched rows remain outside covered tool paths."
        )

    covered_paths = ", ".join(f"{path}[*].op" for path, _keys in _TOOL_PATHS)
    print(
        f"Verified zero old platform op keys at covered paths ({covered_paths}) "
        "and zero uncovered LIKE matches."
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.environ.get("POSTGRES_URI_CORE") or os.environ.get("DATABASE_URL"),
        help="Core Postgres URL. Defaults to POSTGRES_URI_CORE, then DATABASE_URL.",
    )
    parser.add_argument("--project-id", help="Optional project UUID to sweep.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        dest="dry_run",
        action="store_true",
        default=True,
        help="Print matching revisions without committing updates (default).",
    )
    mode.add_argument(
        "--apply",
        dest="dry_run",
        action="store_false",
        help="Commit rewritten workflow revisions, then verify.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.database_url:
        raise SystemExit(
            "Missing database URL: set POSTGRES_URI_CORE or pass --database-url."
        )

    database_url = _sync_psycopg_url(args.database_url)
    with psycopg.connect(database_url) as conn:
        sweep(conn, project_id=args.project_id, dry_run=args.dry_run)
        if not args.dry_run:
            assert_clean(conn, project_id=args.project_id)


if __name__ == "__main__":
    main()
