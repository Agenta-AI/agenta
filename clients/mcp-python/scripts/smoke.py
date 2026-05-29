"""Live read smoke test for the Agenta MCP core client.

Requires AGENTA_API_KEY and AGENTA_API_URL. It intentionally performs read-only
calls: list applications and list evaluator templates.
"""

from __future__ import annotations

import asyncio
import json

from agenta_mcp import AgentaClient


def summarize(payload: dict) -> dict:
    return {
        "count": payload.get("count"),
        "keys": sorted(payload.keys()),
    }


async def main() -> None:
    client = AgentaClient()
    applications = await client.query("application", windowing={"limit": 1})
    templates = await client.list_evaluator_templates()
    print(
        json.dumps(
            {"applications": summarize(applications), "templates": summarize(templates)},
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
