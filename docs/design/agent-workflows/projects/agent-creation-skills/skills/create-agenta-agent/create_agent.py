# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx"]
# ///
"""Create an Agenta agent end to end and invoke it.

Runs the full loop: create workflow -> create variant -> commit a revision with the agent
config -> invoke. Prints each response. Use cheap models when testing.

Usage:
    uv run create_agent.py \
        --host http://localhost:8280 \
        --key  <AGENTA_API_KEY> \
        --project <PROJECT_ID> \
        [--model openai/gpt-4o-mini] [--harness pi_core] \
        [--prompt "You are a terse geography bot."] \
        [--question "What is the capital of France?"] \
        [--archive]   # archive the test workflow when done

Verified against the live dev stack on 2026-06-26. The whole loop is four HTTP calls; the
config object is identical for the stored revision and the invoke.
"""

import argparse
import json
import sys
import uuid

import httpx


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", required=True, help="e.g. http://localhost:8280")
    ap.add_argument("--key", required=True, help="Agenta API key (ApiKey auth)")
    ap.add_argument("--project", required=True, help="project_id (UUID)")
    ap.add_argument("--model", default="openai/gpt-4o-mini")
    ap.add_argument(
        "--harness", default="pi_core", choices=["pi_core", "pi_agenta", "claude"]
    )
    ap.add_argument(
        "--prompt",
        default="You are a helpful research assistant. Answer in one short sentence.",
    )
    ap.add_argument("--question", default="What is the capital of France?")
    ap.add_argument(
        "--archive", action="store_true", help="archive the created workflow at the end"
    )
    args = ap.parse_args()

    g = uuid.uuid4().hex[:8]
    auth = {"Authorization": f"ApiKey {args.key}", "Content-Type": "application/json"}
    client = httpx.Client(
        base_url=args.host,
        headers=auth,
        timeout=120,
        params={"project_id": args.project},
    )

    agent_config = {
        "agents_md": args.prompt,
        "model": args.model,
        "tools": [],
        "harness": args.harness,
        "sandbox": "local",
        "permission_policy": "auto",
    }

    def call(label: str, r: httpx.Response) -> dict:
        print(f"\n### {label}: {r.status_code}")
        try:
            body = r.json()
            print(json.dumps(body, indent=2)[:900])
        except Exception:
            print(r.text[:600])
            body = {}
        if r.status_code >= 300:
            sys.exit(f"{label} failed")
        return body

    # 1. create workflow artifact
    wf = call(
        "1. CREATE WORKFLOW",
        client.post(
            "/api/workflows/",
            json={
                "workflow": {
                    "slug": f"my-agent-{g}",
                    "name": f"My Agent {g}",
                    "description": "Agent created by create_agent.py",
                    "flags": {"is_custom": False},
                }
            },
        ),
    )["workflow"]

    # 2. create variant
    var = call(
        "2. CREATE VARIANT",
        client.post(
            "/api/workflows/variants/",
            json={
                "workflow_variant": {
                    "name": f"main-{g}",
                    "slug": f"main-{g}",
                    "description": "main variant",
                    "workflow_id": wf["id"],
                }
            },
        ),
    )["workflow_variant"]

    # 3. commit a revision carrying the agent config
    call(
        "3. COMMIT REVISION (agent config)",
        client.post(
            "/api/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "message": "initial agent config",
                    "slug": f"rev-{g}",
                    "workflow_variant_id": var["id"],
                    "data": {
                        "uri": "agenta:builtin:agent:v0",
                        "parameters": {"agent": agent_config},
                    },
                }
            },
        ),
    )

    # 4. invoke the agent
    out = call(
        "4. INVOKE AGENT",
        client.post(
            "/services/agent/v0/invoke",
            headers={**auth, "Accept": "application/json"},
            json={
                "data": {
                    "inputs": {
                        "messages": [{"role": "user", "content": args.question}]
                    },
                    "parameters": {"agent": agent_config},
                }
            },
        ),
    )
    answer = out.get("data", {}).get("outputs", {}).get("content")
    print(f"\n>>> answer: {answer}")

    if args.archive:
        call(
            "5. ARCHIVE WORKFLOW (cleanup)",
            client.post(f"/api/workflows/{wf['id']}/archive"),
        )

    print(f"\nworkflow_id={wf['id']} variant_id={var['id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
