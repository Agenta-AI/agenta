# /// script
# dependencies = ["httpx"]
# ///
"""Seed the demo using AGENTA_API_URL, AGENTA_API_KEY, PROJECT_ID and AGENT_ID.

The creator must already have a custom MCP connection named `linear`. No credentials
are persisted by this script. Existing agent settings and MCP entries are preserved.
"""

import json
import os
from pathlib import Path

import httpx


def rpc(client, url, method, params, request_id):
    response = client.post(
        url,
        json={"jsonrpc": "2.0", "id": request_id, "method": method, "params": params},
    )
    response.raise_for_status()
    if response.headers.get("mcp-session-id"):
        client.headers["Mcp-Session-Id"] = response.headers["mcp-session-id"]
    if "text/event-stream" in response.headers.get("content-type", ""):
        messages = []
        for block in response.text.replace("\r\n", "\n").split("\n\n"):
            data = "\n".join(
                line[5:].lstrip(" ")
                for line in block.splitlines()
                if line.startswith("data:")
            )
            if data:
                messages.append(json.loads(data))
        message = next(
            (item for item in messages if item.get("id") == request_id), None
        )
    else:
        message = response.json()
    if not message or message.get("id") != request_id or message.get("error"):
        raise RuntimeError(
            f"MCP {method} failed. Check access to the declared connection."
        )
    return message["result"]


def seed():
    api = os.environ["AGENTA_API_URL"].rstrip("/")
    key = os.environ["AGENTA_API_KEY"]
    project_id = os.environ["PROJECT_ID"]
    agent_id = os.environ["AGENT_ID"]
    source = Path(__file__).parent / "linear-triage"
    manifest = json.loads((source / "plugin.json").read_text())
    with httpx.Client(
        headers={"Authorization": f"ApiKey {key}", "Accept": "application/json"},
        params={"project_id": project_id},
        timeout=90,
    ) as client:
        response = client.get(
            api + "/access/permissions/check",
            params={
                "project_id": project_id,
                "action": "run_service",
                "resource_type": "service",
                "without_grants": "true",
            },
        )
        response.raise_for_status()
        credential = response.json()["credentials"]
        for server in manifest["mcps"]:
            connection = server["connection"]
            url = f"{api}/gateways/mcps/custom/{connection['slug']}"
            with httpx.Client(
                headers={
                    "X-AG-Credentials": credential,
                    "Accept": "application/json, text/event-stream",
                },
                timeout=45,
            ) as mcp:
                info = rpc(
                    mcp,
                    url,
                    "initialize",
                    {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {},
                        "clientInfo": {"name": "plugin-seed", "version": "1"},
                    },
                    1,
                )
                mcp.headers["MCP-Protocol-Version"] = info["protocolVersion"]
                notification = mcp.post(
                    url, json={"jsonrpc": "2.0", "method": "notifications/initialized"}
                )
                notification.raise_for_status()
                tools = rpc(mcp, url, "tools/list", {}, 2)["tools"]
                available = {tool["name"] for tool in tools}
                required = {"list_issues", "get_issue", "update_issue"}
                if not required <= available:
                    raise RuntimeError(
                        "Linear tool names differ from the demo. Inspect tools/list and update the demo before seeding."
                    )
        manifest["ui"] = {"html": (source / "ui.html").read_text()}
        workflow = {
            "name": "Linear triage",
            "flags": {"is_application": True},
            "data": {
                "uri": "agenta:custom:plugin:v0",
                "runtime": "javascript",
                "script": (source / "index.js").read_text(),
                "parameters": {"plugin": manifest},
            },
        }
        response = client.post(
            api + "/simple/workflows/query",
            json={"workflow": {"slug": "linear-triage"}},
        )
        response.raise_for_status()
        existing = response.json()["workflows"]
        if existing:
            plugin_id = existing[0]["id"]
            response = client.put(
                api + f"/simple/workflows/{plugin_id}",
                json={"workflow": {"id": plugin_id, **workflow}},
            )
        else:
            response = client.post(
                api + "/simple/workflows/",
                json={"workflow": {"slug": "linear-triage", **workflow}},
            )
        response.raise_for_status()
        plugin = response.json()["workflow"]
        response = client.get(api + f"/simple/workflows/{agent_id}")
        response.raise_for_status()
        agent = response.json()["workflow"]
        config = agent["data"]["parameters"]["agent"]
        servers = config.setdefault("mcps", [])
        entry = next(
            (entry for entry in servers if entry.get("name") == "linear-triage"), None
        )
        if entry is None:
            servers.append(
                {
                    "name": "linear-triage",
                    "connection": {
                        "type": "gateway",
                        "namespace": "builtin",
                        "provider": "plugin",
                        "slug": "linear-triage",
                    },
                    "policy": {
                        "permission": "allow",
                        "tool_permissions": {"bulk_label": "ask"},
                    },
                }
            )
            response = client.put(
                api + f"/simple/workflows/{agent_id}",
                json={"workflow": {"id": agent_id, "data": agent["data"]}},
            )
            response.raise_for_status()
            agent = response.json()["workflow"]
        print("Plugin:", plugin["id"])
        print("Agent revision:", agent["revision_id"])


if __name__ == "__main__":
    seed()
