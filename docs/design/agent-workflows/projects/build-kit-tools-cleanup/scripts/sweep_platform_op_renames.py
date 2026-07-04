#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "psycopg[binary]>=3.2",
# ]
# ///
"""Rewrite committed build-kit references in workflow revisions.

Hard-migrates workflow_revisions.data at covered tool paths:
    data.parameters.agent.tools[*].op
    data.parameters.tools[*].op
    data.parameters.prompt.llm_config.tools[*].op
    data.parameters.prompt.tools[*].op

Renames:
    find_capabilities -> discover_tools
    find_triggers -> discover_triggers

Hard-migrates workflow_revisions.data at covered skill embed paths:
    data.parameters.agent.skills[*]["@ag.embed"]["@ag.references"].workflow.slug

Skill embeds:
    __ag__build_your_first_app -> __ag__build_an_agent
    __ag__discover_and_wire_tools -> __ag__build_an_agent
    __ag__set_up_triggers -> __ag__build_an_agent

If a skill list contains several old authoring embeds, the first becomes the playbook and the
rest are removed so the resulting list carries one playbook embed.

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

OLD_SKILL_SLUGS = {
    "__ag__build_your_first_app",
    "__ag__discover_and_wire_tools",
    "__ag__set_up_triggers",
}
PLAYBOOK_SKILL_SLUG = "__ag__build_an_agent"

_TOOL_PATHS = (
    ("parameters.agent.tools", ("parameters", "agent", "tools")),
    ("parameters.tools", ("parameters", "tools")),
    (
        "parameters.prompt.llm_config.tools",
        ("parameters", "prompt", "llm_config", "tools"),
    ),
    ("parameters.prompt.tools", ("parameters", "prompt", "tools")),
)

_SKILL_PATHS = (("parameters.agent.skills", ("parameters", "agent", "skills")),)


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


def _set_path(data: Any, keys: tuple[str, ...], value: Any) -> None:
    parent = _get_path(data, keys[:-1])
    if isinstance(parent, dict):
        parent[keys[-1]] = value


def _tool_collections(data: Any) -> list[tuple[str, tuple[str, ...], list[Any]]]:
    collections: list[tuple[str, tuple[str, ...], list[Any]]] = []
    for path, keys in _TOOL_PATHS:
        tools = _get_path(data, keys)
        if isinstance(tools, list):
            collections.append((path, keys, tools))
    return collections


def _skill_collections(data: Any) -> list[tuple[str, tuple[str, ...], list[Any]]]:
    collections: list[tuple[str, tuple[str, ...], list[Any]]] = []
    for path, keys in _SKILL_PATHS:
        skills = _get_path(data, keys)
        if isinstance(skills, list):
            collections.append((path, keys, skills))
    return collections


def _embed_reference(entry: Any) -> dict[str, Any] | None:
    if not isinstance(entry, dict):
        return None
    embed = entry.get("@ag.embed")
    if not isinstance(embed, dict):
        return None
    refs = embed.get("@ag.references")
    if not isinstance(refs, dict):
        return None
    workflow = refs.get("workflow")
    if isinstance(workflow, dict):
        return workflow
    return None


def _skill_embed_slug(entry: Any) -> str | None:
    workflow = _embed_reference(entry)
    slug = workflow.get("slug") if workflow else None
    return slug if isinstance(slug, str) else None


def _set_skill_embed_slug(entry: Any, slug: str) -> None:
    workflow = _embed_reference(entry)
    if workflow is not None:
        workflow["slug"] = slug


def old_op_paths(data: Any) -> list[tuple[str, int, str]]:
    paths: list[tuple[str, int, str]] = []
    for path, _keys, tools in _tool_collections(data):
        for index, tool in enumerate(tools):
            if isinstance(tool, dict) and tool.get("op") in RENAMES:
                paths.append((path, index, str(tool["op"])))
    return paths


def old_skill_embed_paths(data: Any) -> list[tuple[str, int, str]]:
    paths: list[tuple[str, int, str]] = []
    for path, _keys, skills in _skill_collections(data):
        for index, skill in enumerate(skills):
            slug = _skill_embed_slug(skill)
            if slug in OLD_SKILL_SLUGS:
                paths.append((path, index, slug))
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


def _planned_skill_embed_changes(data: Any) -> list[tuple[str, int, str, str | None]]:
    changes: list[tuple[str, int, str, str | None]] = []
    for path, _keys, skills in _skill_collections(data):
        seen_playbook = False
        for index, skill in enumerate(skills):
            slug = _skill_embed_slug(skill)
            if slug == PLAYBOOK_SKILL_SLUG:
                if seen_playbook:
                    changes.append((path, index, slug, None))
                else:
                    seen_playbook = True
                continue
            if slug not in OLD_SKILL_SLUGS:
                continue
            if seen_playbook:
                changes.append((path, index, slug, None))
            else:
                changes.append((path, index, slug, PLAYBOOK_SKILL_SLUG))
                seen_playbook = True
    return changes


def rewrite_skill_embeds(
    data: Any,
) -> tuple[Any, list[tuple[str, int, str, str | None]]]:
    changes = _planned_skill_embed_changes(data)
    if not changes:
        return data, []

    rewritten = deepcopy(data)
    for _path, keys, skills in _skill_collections(rewritten):
        rewritten_skills: list[Any] = []
        seen_playbook = False
        for skill in skills:
            slug = _skill_embed_slug(skill)
            if slug == PLAYBOOK_SKILL_SLUG:
                if seen_playbook:
                    continue
                seen_playbook = True
                rewritten_skills.append(skill)
                continue
            if slug in OLD_SKILL_SLUGS:
                if seen_playbook:
                    continue
                _set_skill_embed_slug(skill, PLAYBOOK_SKILL_SLUG)
                seen_playbook = True
                rewritten_skills.append(skill)
                continue
            rewritten_skills.append(skill)
        _set_path(rewritten, keys, rewritten_skills)
    return rewritten, changes


def rewrite_revision_data(
    data: Any,
) -> tuple[
    Any,
    list[tuple[str, int, str, str]],
    list[tuple[str, int, str, str | None]],
]:
    rewritten, op_changes = rewrite_ops(data)
    rewritten, skill_changes = rewrite_skill_embeds(rewritten)
    return rewritten, op_changes, skill_changes


def _select_candidates(
    conn: psycopg.Connection[Any], project_id: str | None
) -> list[tuple[str, str, Any]]:
    match_terms = {
        "find_capabilities": "%find_capabilities%",
        "find_triggers": "%find_triggers%",
        "build_your_first_app": "%__ag__build_your_first_app%",
        "discover_and_wire_tools": "%__ag__discover_and_wire_tools%",
        "set_up_triggers": "%__ag__set_up_triggers%",
    }
    where = [
        "data IS NOT NULL",
        "(" + " OR ".join(f"data::text LIKE %({key})s" for key in match_terms) + ")",
    ]
    params: dict[str, Any] = dict(match_terms)
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
    updated_skill_embeds = 0
    dropped_skill_embeds = 0

    for row_project_id, revision_id, data in _select_candidates(conn, project_id):
        rewritten, op_changes, skill_changes = rewrite_revision_data(data)
        if not op_changes and not skill_changes:
            print(
                f"{row_project_id}/{revision_id}: "
                "matched but not rewritten (uncovered path)"
            )
            continue

        updated_revisions += 1
        updated_tools += len(op_changes)
        updated_skill_embeds += sum(
            1 for *_rest, new in skill_changes if new is not None
        )
        dropped_skill_embeds += sum(1 for *_rest, new in skill_changes if new is None)

        for path, index, old, new in op_changes:
            print(f"{row_project_id}/{revision_id}: {path}[{index}].op {old} -> {new}")
        for path, index, old, new in skill_changes:
            if new is None:
                print(
                    f"{row_project_id}/{revision_id}: "
                    f"dropped duplicate {path}[{index}] embed {old}"
                )
            else:
                print(
                    f"{row_project_id}/{revision_id}: "
                    f"{path}[{index}] embed {old} -> {new}"
                )

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
            f"Dry run: would update {updated_tools} tool op reference(s), "
            f"rewrite {updated_skill_embeds} skill embed reference(s), and drop "
            f"{dropped_skill_embeds} duplicate skill embed(s) across "
            f"{updated_revisions} workflow revision(s)."
        )
        return updated_tools + updated_skill_embeds + dropped_skill_embeds

    conn.commit()
    print(
        f"Updated {updated_tools} tool op reference(s), rewrote "
        f"{updated_skill_embeds} skill embed reference(s), and dropped "
        f"{dropped_skill_embeds} duplicate skill embed(s) across "
        f"{updated_revisions} workflow revision(s)."
    )
    return updated_tools + updated_skill_embeds + dropped_skill_embeds


def assert_clean(conn: psycopg.Connection[Any], *, project_id: str | None) -> None:
    leftovers: list[str] = []
    uncovered: list[str] = []
    for row_project_id, revision_id, data in _select_candidates(conn, project_id):
        op_paths = old_op_paths(data)
        skill_paths = old_skill_embed_paths(data)
        if op_paths or skill_paths:
            for path, index, old in op_paths:
                leftovers.append(
                    f"{row_project_id}/{revision_id}: {path}[{index}].op = {old}"
                )
            for path, index, old in skill_paths:
                leftovers.append(
                    f"{row_project_id}/{revision_id}: {path}[{index}] embed = {old}"
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
            f"Sweep incomplete; old build-kit references remain:\n{details}{more}"
        )

    if uncovered:
        details = "\n".join(uncovered[:20])
        more = "" if len(uncovered) <= 20 else f"\n... and {len(uncovered) - 20} more"
        print(details + more)
        raise SystemExit(
            "Sweep incomplete; LIKE-matched rows remain outside covered paths."
        )

    covered_tool_paths = ", ".join(f"{path}[*].op" for path, _keys in _TOOL_PATHS)
    covered_skill_paths = ", ".join(f"{path}[*]" for path, _keys in _SKILL_PATHS)
    print(
        "Verified zero old platform op keys and skill embeds at covered paths "
        f"({covered_tool_paths}; {covered_skill_paths}) and zero uncovered LIKE matches."
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
