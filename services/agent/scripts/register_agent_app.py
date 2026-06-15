# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Register the agent as an app in a running Agenta stack, pointing at the dockerized
agent service. Run it, then open the app in the playground and chat.

It creates a workflow + default variant and commits a revision whose `data.url` points
at the agent service and whose `data.schemas` is the chat interface the agent serves
from /inspect (so the playground renders a chat box). This is the "custom workflow"
path: no static SDK interface, the agent self-describes.

Env:
  AGENTA_HOST     base host (default http://144.76.237.122:8280)
  AGENTA_API_KEY  api key for that stack (Authorization: ApiKey ...)
  AGENT_URL       agent service invoke base (default http://144.76.237.122:8092/agent/v0)
  PROJECT_ID      optional; defaults to the stack's default project
  APP_SLUG        optional; defaults to wp2-agent-<n>

Usage:
  AGENTA_API_KEY=... uv run services/agent/scripts/register_agent_app.py
"""

import os
import secrets
import sys

import requests

HOST = os.environ.get("AGENTA_HOST", "http://144.76.237.122:8280").rstrip("/")
API = HOST + "/api"
KEY = os.environ.get("AGENTA_API_KEY")
AGENT_URL = os.environ.get("AGENT_URL", "http://144.76.237.122:8092/agent/v0").rstrip(
    "/"
)
PROJECT_ID = os.environ.get("PROJECT_ID")
APP_SLUG = os.environ.get("APP_SLUG") or f"wp2-agent-{secrets.token_hex(3)}"

if not KEY:
    sys.exit("Set AGENTA_API_KEY")

H = {"Authorization": f"ApiKey {KEY}", "Content-Type": "application/json"}

# The chat interface the agent advertises via /inspect (kept in sync with
# services/oss/src/agent_pi/schemas.py).
SCHEMA = "https://json-schema.org/draft/2020-12/schema"
AGENT_SCHEMAS = {
    "inputs": {
        "$schema": SCHEMA,
        "type": "object",
        "additionalProperties": True,
        "properties": {
            "messages": {
                "x-ag-type-ref": "messages",
                "type": "array",
                "description": "Ordered list of normalized chat messages.",
            }
        },
    },
    "parameters": {
        "$schema": SCHEMA,
        "type": "object",
        "additionalProperties": True,
        "properties": {"model": {"type": "string", "description": "Model override."}},
    },
    "outputs": {
        "$schema": SCHEMA,
        "x-ag-type-ref": "message",
        "type": "object",
        "description": "Final assistant message returned by the agent.",
    },
}


def _id() -> str:
    return secrets.token_hex(6)


def post(path: str, body: dict) -> dict:
    r = requests.post(
        f"{API}{path}",
        json=body,
        headers=H,
        params={"project_id": PROJECT_ID},
        timeout=60,
    )
    if r.status_code >= 300:
        sys.exit(f"POST {path} -> {r.status_code}: {r.text[:600]}")
    return r.json()


def main() -> None:
    global PROJECT_ID
    if not PROJECT_ID:
        projects = requests.get(f"{API}/projects", headers=H, timeout=30).json()
        default = next(
            (p for p in projects if p.get("is_default_project")), projects[0]
        )
        PROJECT_ID = default["project_id"]
    print(f"project_id={PROJECT_ID}  app_slug={APP_SLUG}  agent_url={AGENT_URL}")

    wf = post(
        "/workflows/",
        {
            "workflow": {
                "slug": APP_SLUG,
                "name": APP_SLUG,
                "flags": {"is_application": True},
            }
        },
    )
    workflow_id = wf["workflow"]["id"]

    var = post(
        "/workflows/variants/",
        {
            "workflow_variant": {
                "workflow_id": workflow_id,
                "slug": f"{APP_SLUG}.default",
                "name": "default",
            }
        },
    )
    variant_id = var["workflow_variant"]["id"]

    # Seed v0 (tables dismiss v0), then commit v1 with the real data.
    post(
        "/workflows/revisions/commit",
        {
            "workflow_revision": {
                "workflow_id": workflow_id,
                "workflow_variant_id": variant_id,
                "slug": _id(),
                "name": "default",
                "message": "Initial commit",
            }
        },
    )
    rev = post(
        "/workflows/revisions/commit",
        {
            "workflow_revision": {
                "workflow_id": workflow_id,
                "workflow_variant_id": variant_id,
                "slug": _id(),
                "name": "default",
                "message": "Agent service",
                "flags": {"is_chat": True},
                "data": {
                    "url": AGENT_URL,
                    "parameters": {"model": "gpt-5.5"},
                    "schemas": AGENT_SCHEMAS,
                },
            }
        },
    )
    revision = rev["workflow_revision"]
    print(f"workflow_id={workflow_id}")
    print(f"variant_id={variant_id}")
    print(f"revision_id={revision['id']}  flags={revision.get('flags')}")
    print(f"stored url={revision.get('data', {}).get('url')}")
    print(f"\nOpen the playground: {HOST}/apps/{workflow_id}/playground")


if __name__ == "__main__":
    main()
