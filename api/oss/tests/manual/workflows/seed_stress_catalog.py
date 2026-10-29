"""Seed a project with a large workflow catalog, to stress the sidebar's agent list (#6390).

The sidebar classifies agents by fetching every workflow's LATEST revision, and the revision
query is unbounded — so the cost scales on REVISIONS PER WORKFLOW, not on agent count. Seed
depth, not breadth: 20 agents x 40 revisions reproduces the stall; 500 agents x 1 revision
does not.

Workflows, variants and revisions go through the HTTP API so `is_agent` is inferred by the
real commit path. Sessions are inserted straight into `session_streams` with psql: the
`/sessions/streams/` route drives the runner, which needs provider keys and real turns.

Usage (local EE dev stack):

    python api/oss/tests/manual/workflows/seed_stress_catalog.py \
        --api-key "ApiKey xxxx.yyyy" \
        --project-id 01a06ad3-d9c3-7423-b2ae-1983d5de5b72 \
        --agents 20 --prompts 10 --revisions 40 --sessions 500

Mint a key for an existing project with:

    docker exec agenta-ee-dev-api-1 python -c "
    import asyncio
    from oss.src.services.api_key_service import create_api_key
    print(asyncio.run(create_api_key('<user_id>', '<project_id>')))"
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib import error, request

AGENT_URI = "agenta:builtin:agent:v0"
AGENT_URL = "http://localhost/services/agent/v0"
PROMPT_URI = "agenta:builtin:llm:v0"
PROMPT_URL = "http://localhost/services/llm/v0"

DEFAULT_DB_DSN = "postgresql://username:password@127.0.0.1:5432/agenta_ee_core"


def _post(api_url: str, api_key: str, project_id: str, path: str, body: dict) -> dict:
    req = request.Request(
        f"{api_url}{path}?project_id={project_id}",
        data=json.dumps(body).encode(),
        headers={"Authorization": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=120) as response:
            return json.loads(response.read())
    except error.HTTPError as exc:
        raise SystemExit(
            f"POST {path} -> {exc.code}: {exc.read().decode()[:500]}"
        ) from exc


def agent_parameters(
    skills: int, tools: int, instruction_kb: int, revision: int
) -> dict:
    """A payload shaped like a real agent revision — instructions and skills carry the weight.

    A production agent revision measures ~20KB; the knobs here reproduce that so the stress
    run moves the same bytes a real project does.

    `revision` varies the content: commits are git-style, so re-committing identical data is a
    no-op and the revisions never accumulate.
    """
    return {
        "agent": {
            "instructions": {
                "role": "system",
                "content": (
                    f"You are stress-test agent revision {revision}. "
                    + ("You are a stress-test agent. " * 40 * max(instruction_kb, 1))
                ),
            },
            "llm": {"model": "gpt-4o-mini", "temperature": 0.7, "max_tokens": 2048},
            "tools": [
                {
                    "name": f"tool_{index}",
                    "description": f"Stress-test tool {index}. " * 8,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            f"arg_{arg}": {
                                "type": "string",
                                "description": f"Argument {arg} of tool {index}. " * 4,
                            }
                            for arg in range(4)
                        },
                        "required": ["arg_0"],
                    },
                }
                for index in range(tools)
            ],
            "mcps": [],
            "harness": {"key": "claude-code"},
            "runner": {"provider": "local"},
            "sandbox": {},
            "skills": [
                {
                    "name": f"skill_{index}",
                    "description": f"Stress-test skill {index}. " * 10,
                    "content": f"# Skill {index}\n\nStress-test skill body. " * 30,
                }
                for index in range(skills)
            ],
        }
    }


def revision_data(
    is_agent: bool, skills: int, tools: int, instruction_kb: int, revision: int
) -> dict:
    if not is_agent:
        return {
            "uri": PROMPT_URI,
            "url": PROMPT_URL,
            "parameters": {
                "prompt": {
                    "messages": [
                        {
                            "role": "system",
                            "content": f"Stress prompt revision {revision}.",
                        }
                    ]
                }
            },
        }
    return {
        "uri": AGENT_URI,
        "url": AGENT_URL,
        "parameters": agent_parameters(skills, tools, instruction_kb, revision),
    }


def create_workflow(ctx: dict, index: int, is_agent: bool) -> dict:
    kind = "agent" if is_agent else "prompt"
    marker = uuid.uuid4().hex[:8]
    slug = f"stress-{kind}-{index:03d}-{marker}"

    workflow = _post(
        ctx["api_url"],
        ctx["api_key"],
        ctx["project_id"],
        "/workflows/",
        {
            "workflow": {
                "slug": slug,
                # Batch-tagged: the slug is unique per run but the name is what the rail
                # renders, so without this a second run gives two agents the same heading.
                "name": f"Stress {kind.title()} {index:03d} [{ctx['batch']}]",
                "description": f"Seeded by seed_stress_catalog.py ({kind})",
                "flags": {
                    "is_application": True,
                    "is_evaluator": False,
                    "is_snippet": False,
                },
            }
        },
    )["workflow"]

    variant = _post(
        ctx["api_url"],
        ctx["api_key"],
        ctx["project_id"],
        "/workflows/variants/",
        {
            "workflow_variant": {
                "slug": f"{slug}.default",
                "name": "default",
                "workflow_id": workflow["id"],
                "flags": {
                    "is_application": True,
                    "is_evaluator": False,
                    "is_snippet": False,
                },
            }
        },
    )["workflow_variant"]

    for revision in range(ctx["revisions"]):
        _post(
            ctx["api_url"],
            ctx["api_key"],
            ctx["project_id"],
            "/workflows/revisions/commit",
            {
                "workflow_revision": {
                    "slug": uuid.uuid4().hex[-12:],
                    "message": f"Stress revision {revision + 1}",
                    "workflow_id": workflow["id"],
                    "workflow_variant_id": variant["id"],
                    "data": revision_data(
                        is_agent,
                        ctx["skills"],
                        ctx["tools"],
                        ctx["instruction_kb"],
                        revision,
                    ),
                }
            },
        )

    return {
        "workflow": workflow,
        "variant": variant,
        "is_agent": is_agent,
        "slug": slug,
    }


def add_placeholder_variant(ctx: dict, seeded: dict) -> None:
    """A second variant holding only its v0 placeholder — the multi-variant correctness trap.

    Its placeholder revision has a NEWER id than the first variant's real head, so any
    "newest revision per artifact" that forgets to exclude placeholders returns an empty v0
    and the agent silently drops out of the Agents group into Prompts.
    """
    _post(
        ctx["api_url"],
        ctx["api_key"],
        ctx["project_id"],
        "/workflows/variants/",
        {
            "workflow_variant": {
                "slug": f"{seeded['slug']}.placeholder",
                "name": "placeholder",
                "workflow_id": seeded["workflow"]["id"],
                "flags": {
                    "is_application": True,
                    "is_evaluator": False,
                    "is_snippet": False,
                },
            }
        },
    )


def session_rows(
    project_id: str, user_id: str, agents: list[dict], count: int, skew: bool = False
) -> str:
    """SQL for `count` session_streams rows, spread across the seeded agents.

    Round-robin spreads the newest sessions one per agent, so the rail's 50-row window shows
    ~2 rows under every heading. `skew` concentrates them on a few agents instead, which is
    both what real projects look like and what actually exercises grouped rendering.
    """
    now = datetime.now(timezone.utc)
    values = []
    for index in range(count):
        if skew:
            # Newest sessions land on the first agents: index // 3 keeps the head dense and
            # lets the tail fall off the rail's window, the way a real project does.
            agent = agents[
                min(index // max(count // (len(agents) * 3), 1), len(agents) - 1)
            ]
        else:
            agent = agents[index % len(agents)]
        session_uuid = uuid.uuid4()
        created = now - timedelta(minutes=index * 7)
        references = json.dumps(
            [
                {
                    "id": agent["workflow"]["id"],
                    "key": "workflow",
                    "slug": agent["slug"],
                },
                {
                    "id": agent["variant"]["id"],
                    "key": "workflow_variant",
                    "slug": f"{agent['slug']}.default",
                },
            ]
        ).replace("'", "''")
        values.append(
            "('{id}'::uuid, '{project}'::uuid, '{session}', "
            '\'{{"is_alive": false, "is_running": false, "is_attached": false}}\'::jsonb, '
            "'{created}'::timestamptz, '{created}'::timestamptz, '{user}'::uuid, "
            "'Stress session {index:04d}', '{refs}'::jsonb)".format(
                id=session_uuid,
                project=project_id,
                session=session_uuid,
                created=created.isoformat(),
                user=user_id,
                index=index,
                refs=references,
            )
        )

    return (
        "INSERT INTO session_streams (id, project_id, session_id, flags, created_at, "
        'updated_at, created_by_id, name, "references") VALUES\n'
        + ",\n".join(values)
        + "\nON CONFLICT DO NOTHING;"
    )


def run_sql(dsn: str, sql: str) -> None:
    result = subprocess.run(
        ["psql", dsn, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
        input=sql,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SystemExit(f"psql failed: {result.stderr[:1000]}")


def resolve_existing_agents(dsn: str, project_id: str) -> list[dict]:
    """Seeded agents already in the project — lets a sessions-only run reuse them."""
    result = subprocess.run(
        [
            "psql",
            dsn,
            "-t",
            "-A",
            "-F",
            "\t",
            "-c",
            "SELECT wa.id, wa.slug, wv.id FROM workflow_artifacts wa "
            "JOIN workflow_variants wv ON wv.artifact_id = wa.id "
            f"WHERE wa.project_id = '{project_id}' AND wa.deleted_at IS NULL "
            "AND wa.slug LIKE 'stress-agent-%' AND wv.slug LIKE '%.default';",
        ],
        capture_output=True,
        text=True,
    )
    agents = []
    for line in result.stdout.strip().splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        agents.append(
            {
                "workflow": {"id": parts[0]},
                "slug": parts[1],
                "variant": {"id": parts[2]},
            }
        )
    return agents


def resolve_user_id(dsn: str, project_id: str) -> str:
    result = subprocess.run(
        [
            "psql",
            dsn,
            "-t",
            "-A",
            "-c",
            f"SELECT user_id FROM project_members WHERE project_id = '{project_id}' LIMIT 1;",
        ],
        capture_output=True,
        text=True,
    )
    user_id = result.stdout.strip()
    if not user_id:
        raise SystemExit(f"No project member found for project {project_id}")
    return user_id


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://localhost/api")
    parser.add_argument("--api-key", required=True, help='e.g. "ApiKey prefix.secret"')
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--db-dsn", default=DEFAULT_DB_DSN)
    parser.add_argument("--agents", type=int, default=20)
    parser.add_argument("--prompts", type=int, default=10)
    parser.add_argument(
        "--revisions",
        type=int,
        default=40,
        help="per workflow — the axis that actually hurts",
    )
    parser.add_argument("--sessions", type=int, default=500)
    parser.add_argument("--skills", type=int, default=8, help="payload weight knob")
    parser.add_argument("--tools", type=int, default=6, help="payload weight knob")
    parser.add_argument("--instruction-kb", type=int, default=2)
    parser.add_argument(
        "--multi-variant",
        type=int,
        default=1,
        help="agents given a placeholder-only second variant (the v0 trap)",
    )
    parser.add_argument("--concurrency", type=int, default=6)
    parser.add_argument(
        "--skew",
        action="store_true",
        help="pile sessions onto a few agents instead of spreading them evenly — the rail "
        "fetches only its window, so a round-robin spread shows ~2 rows per agent",
    )
    parser.add_argument(
        "--batch", default=uuid.uuid4().hex[:4], help="tag for display names"
    )
    args = parser.parse_args()

    ctx = {
        "api_url": args.api_url.rstrip("/"),
        "api_key": args.api_key,
        "project_id": args.project_id,
        "batch": args.batch,
        "revisions": args.revisions,
        "skills": args.skills,
        "tools": args.tools,
        "instruction_kb": args.instruction_kb,
    }

    total = args.agents + args.prompts
    print(
        f"Seeding {args.agents} agents + {args.prompts} prompts "
        f"x {args.revisions} revisions = {total * args.revisions} commits",
        flush=True,
    )

    plan = [(index, True) for index in range(args.agents)]
    plan += [(index, False) for index in range(args.prompts)]

    seeded: list[dict] = []
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [
            pool.submit(create_workflow, ctx, index, is_agent)
            for index, is_agent in plan
        ]
        for done, future in enumerate(futures, start=1):
            seeded.append(future.result())
            print(f"  workflow {done}/{total}", flush=True)

    agents = [entry for entry in seeded if entry["is_agent"]]

    for entry in agents[: args.multi_variant]:
        add_placeholder_variant(ctx, entry)
        print(f"  placeholder variant on {entry['slug']}", flush=True)

    # A sessions-only run (--agents 0) reuses whatever the project already has.
    if args.sessions and not agents:
        agents = resolve_existing_agents(args.db_dsn, args.project_id)
        print(f"  reusing {len(agents)} existing stress agents", flush=True)

    if args.sessions and agents:
        user_id = resolve_user_id(args.db_dsn, args.project_id)
        run_sql(
            args.db_dsn,
            session_rows(args.project_id, user_id, agents, args.sessions, args.skew),
        )
        print(f"  {args.sessions} sessions", flush=True)

    print("Done.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
