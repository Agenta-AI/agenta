# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""Commit an agent revision that exposes harness + sandbox as editable playground config.

Adds two enum string params (harness: pi/claude, sandbox: local/daytona) to the agent
workflow's parameters schema, alongside the existing model + agents_md, so the playground
renders them as dropdowns (SchemaPropertyRenderer -> EnumSelectControl). WP-8 point 4.
"""

import os
import httpx

BASE = os.getenv("AGENTA_HOST", "http://144.76.237.122:8280").rstrip("/")
KEY = os.environ["AGENTA_API_KEY"]
PROJ = os.getenv("AGENTA_PROJECT_ID", "019ecbaf-5f3f-7d12-9aef-f49272dfd82e")
REV = os.getenv("AGENT_REVISION_ID", "019ecfc9-1ea0-7293-aa1c-350c029cb118")

H = {"Authorization": f"ApiKey {KEY}", "Content-Type": "application/json"}


def main() -> None:
    with httpx.Client(timeout=30) as client:
        r = client.get(
            f"{BASE}/api/workflows/revisions/{REV}",
            params={"project_id": PROJ},
            headers=H,
        )
        r.raise_for_status()
        wr = r.json()["workflow_revision"]
        variant_id = wr["workflow_variant_id"]
        data = dict(wr["data"])

        props = data["schemas"]["parameters"]["properties"]
        props["harness"] = {
            "type": "string",
            "title": "Harness",
            "enum": ["pi", "claude"],
            "default": "pi",
            "description": "Coding agent engine to drive over ACP.",
        }
        props["sandbox"] = {
            "type": "string",
            "title": "Sandbox",
            "enum": ["local", "daytona"],
            "default": "local",
            "description": "Where the agent runs.",
        }
        params = dict(data["parameters"])
        params.setdefault("harness", "pi")
        params.setdefault("sandbox", "local")
        data["parameters"] = params

        body = {
            "workflow_revision": {
                "workflow_variant_id": variant_id,
                "message": "WP-8: expose harness + sandbox as editable config",
                "data": data,
            }
        }
        resp = client.post(
            f"{BASE}/api/workflows/revisions/commit",
            params={"project_id": PROJ},
            headers=H,
            json=body,
        )
        print("commit status:", resp.status_code)
        out = resp.json()
        new = out.get("workflow_revision") or out
        print("new revision id:", new.get("id"), "version:", new.get("version"))


if __name__ == "__main__":
    main()
