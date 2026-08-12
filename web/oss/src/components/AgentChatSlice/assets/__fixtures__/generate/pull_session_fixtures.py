# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Build golden replay fixtures from the rel112 deployment's real sessions.

Records come from `agenta_ee_tracing.records` in the SAME order the API serves them
(`api/oss/src/dbs/postgres/sessions/records/dao.py:119-123`: timestamp asc nullslast,
created_at asc, record_index asc) and are mapped to the consumer-facing shape the zod
transform produces (`web/packages/agenta-entities/src/session/core/schema.ts:39-49`).

Interaction rows come from `agenta_ee_core.session_interactions` in the wire shape
`sessionInteractionSchema` validates.

Long strings are elided the way `abandonedFormSession.json` did: first 80 code points plus
a `… <N chars elided>` marker. Structure is never touched.

Read-only. Run against a deployment that still holds these sessions:

    uv run web/oss/src/components/AgentChatSlice/assets/__fixtures__/generate/pull_session_fixtures.py \\
        web/oss/src/components/AgentChatSlice/assets/__fixtures__
"""

import json
import subprocess
import sys
from pathlib import Path

PG = "agenta-ee-dev-rel112-postgres-1"
OUT = Path(sys.argv[1])

SESSIONS = {
    "arabicPoetrySession": "3d99d178-b76b-4eb7-a9e9-ad43295ee2b8",
    "testRunApprovalsSession": "f60bc4f8-cd39-495d-ada8-1ceb354ec16e",
    "connectAndFormsSession": "cfee6813-a5ee-49b4-81ee-56dd1676afa6",
}

KEEP_FULL = 80
ELIDE_OVER = 200


def psql(db: str, sql: str):
    out = subprocess.run(
        [
            "docker",
            "exec",
            PG,
            "psql",
            "-U",
            "username",
            "-d",
            db,
            "-t",
            "-A",
            "-c",
            sql,
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return json.loads(out) if out else []


def elide(value):
    if isinstance(value, str):
        if len(value) <= ELIDE_OVER:
            return value
        return f"{value[:KEEP_FULL]}… <{len(value) - KEEP_FULL} chars elided>"
    if isinstance(value, list):
        return [elide(v) for v in value]
    if isinstance(value, dict):
        return {k: elide(v) for k, v in value.items()}
    return value


def records(session_id: str):
    rows = psql(
        "agenta_ee_tracing",
        f"""
        select coalesce(json_agg(x order by x.timestamp asc nulls last, x.created_at asc, x.record_index asc), '[]')
        from (
          select record_id, session_id, project_id, record_index, record_source, record_type,
                 attributes, timestamp, created_at
          from records where session_id = '{session_id}'
        ) x;
        """,
    )
    return [
        {
            "id": r["record_id"],
            "session_id": r["session_id"],
            "project_id": r["project_id"],
            "event_index": r["record_index"],
            "sender": r["record_source"],
            "session_update": r["record_type"],
            "payload": elide(r["attributes"]),
            "created_at": r["created_at"] or r["timestamp"],
        }
        for r in rows
    ]


def interactions(session_id: str):
    rows = psql(
        "agenta_ee_core",
        f"""
        select coalesce(json_agg(x order by x.created_at asc), '[]')
        from (
          select id, session_id, turn_id, token, kind, status, data, created_at
          from session_interactions where session_id = '{session_id}'
        ) x;
        """,
    )
    return [
        {
            "id": r["id"],
            "session_id": r["session_id"],
            "turn_id": r["turn_id"],
            "token": r["token"],
            "kind": r["kind"],
            "status": r["status"],
            "created_at": r["created_at"],
            "data": elide(r["data"]),
        }
        for r in rows
    ]


for name, session_id in SESSIONS.items():
    recs = records(session_id)
    rows = interactions(session_id)
    (OUT / f"{name}.json").write_text(
        json.dumps(recs, indent=2, ensure_ascii=False) + "\n"
    )
    (OUT / f"{name}.interactions.json").write_text(
        json.dumps(rows, indent=2, ensure_ascii=False) + "\n"
    )
    print(f"{name}: {len(recs)} records, {len(rows)} interaction rows")
