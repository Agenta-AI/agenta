"""Vault-backed secret provider for agent tools and MCP servers."""

from __future__ import annotations

from typing import Mapping, Sequence

import httpx

from agenta.sdk.utils.logging import get_module_logger

from oss.src.agent.client import (
    TOOLS_TIMEOUT,
    agenta_api_base,
    request_authorization,
)

log = get_module_logger(__name__)


async def resolve_named_secrets(names: Sequence[str]) -> dict[str, str]:
    """Resolve project vault secrets by name for tool and MCP environments."""
    if not names:
        return {}

    api_base = agenta_api_base()
    if not api_base:
        return {}

    headers = {"Content-Type": "application/json"}
    authorization = request_authorization()
    if authorization:
        headers["Authorization"] = authorization

    try:
        async with httpx.AsyncClient(timeout=TOOLS_TIMEOUT) as client:
            response = await client.post(
                f"{api_base}/secrets/resolve",
                json={"names": list(names)},
                headers=headers,
            )
        if response.status_code >= 400:
            log.warning(
                "agent: named-secret resolve HTTP %s for %s",
                response.status_code,
                names,
            )
            return {}
        data = response.json() or {}
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: named-secret resolve failed for %s", names, exc_info=True)
        return {}

    resolved = data.get("secrets") if isinstance(data, dict) else None
    resolved = resolved if isinstance(resolved, dict) else {}
    missing = [name for name in names if name not in resolved]
    if missing:
        log.warning("agent: unresolved named secret(s): %s", missing)
    return {
        str(key): str(value) for key, value in resolved.items() if value is not None
    }


class VaultToolSecretProvider:
    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        return await resolve_named_secrets(names)
