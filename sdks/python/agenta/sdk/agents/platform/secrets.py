"""Agenta-platform-backed secret resolution.

Two distinct vault reads, both best-effort (an outage returns empty rather than failing the
run, since a project with no secret-bearing tools still runs):

- `resolve_named_secrets` (`POST /secrets/resolve`): named secret values for code-tool and
  MCP environments, resolved by explicit name. Pairs with the resolver's
  `MissingSecretPolicy.ERROR`, so a tool whose declared secret is absent then hard-fails.
- `resolve_provider_keys` (`GET /secrets/`): the project's LLM provider keys, mapped to the
  env vars a harness reads. Optional by design: when the vault has none, the harness falls
  back to its own login/OAuth, so self-managed Pi/Claude sidecars keep working.

Logs never include secret names or values, only counts.
"""

from __future__ import annotations

from typing import Dict, Mapping, Optional, Sequence

import httpx

from agenta.sdk.utils.logging import get_module_logger

from .connection import PlatformConnection

log = get_module_logger(__name__)


async def resolve_named_secrets(
    names: Sequence[str],
    *,
    connection: Optional[PlatformConnection] = None,
) -> Dict[str, str]:
    """Resolve project vault secrets by name for tool and MCP environments. Best-effort."""
    if not names:
        return {}

    connection = connection or PlatformConnection()
    api_base = connection.base_url()
    if not api_base:
        return {}

    try:
        async with httpx.AsyncClient(timeout=connection.timeout) as client:
            response = await client.post(
                f"{api_base}/secrets/resolve",
                json={"names": list(names)},
                headers=connection.headers(),
            )
        if response.status_code >= 400:
            log.warning(
                "agent: named-secret resolve HTTP %s for %d name(s)",
                response.status_code,
                len(names),
            )
            return {}
        data = response.json() or {}
    except Exception:  # pylint: disable=broad-except
        log.warning(
            "agent: named-secret resolve failed for %d name(s)",
            len(names),
            exc_info=True,
        )
        return {}

    resolved = data.get("secrets") if isinstance(data, dict) else None
    resolved = resolved if isinstance(resolved, dict) else {}
    requested = {str(name) for name in names}
    missing = [name for name in names if name not in resolved]
    if missing:
        log.warning("agent: %d named secret(s) unresolved", len(missing))
    # Restrict to the requested set so an upstream that returns extras never leaks
    # unrequested secrets into runtime memory.
    return {
        str(key): str(value)
        for key, value in resolved.items()
        if value is not None and str(key) in requested
    }


class AgentaNamedSecretProvider:
    """`ToolSecretProvider` backed by the Agenta vault's named-secret resolver."""

    def __init__(self, connection: Optional[PlatformConnection] = None) -> None:
        self._connection = connection or PlatformConnection()

    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        return await resolve_named_secrets(names, connection=self._connection)


# Map a vault standard-provider kind to the env var the harness (Pi/Claude/litellm) reads.
# Only providers an agent harness can use are listed.
_PROVIDER_ENV_VARS = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    "mistralai": "MISTRAL_API_KEY",
    "groq": "GROQ_API_KEY",
    "together_ai": "TOGETHERAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


async def resolve_provider_keys(
    *,
    connection: Optional[PlatformConnection] = None,
) -> Dict[str, str]:
    """Fetch the project vault's provider keys as ``{ENV_VAR: key}``. Best-effort, optional.

    Empty when the vault has none, in which case the harness falls back to its own
    login/OAuth (self-managed Pi/Claude sidecars), so absence is valid, never an error.
    """
    connection = connection or PlatformConnection()
    api_base = connection.base_url()
    if not api_base:
        return {}

    try:
        async with httpx.AsyncClient(timeout=connection.timeout) as client:
            response = await client.get(
                f"{api_base}/secrets/", headers=connection.headers()
            )
        if response.status_code >= 400:
            log.warning("agent: vault secrets fetch HTTP %s", response.status_code)
            return {}
        secrets = response.json() or []
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: vault secrets fetch failed", exc_info=True)
        return {}

    env: Dict[str, str] = {}
    for secret in secrets:
        if not isinstance(secret, dict) or secret.get("kind") != "provider_key":
            continue
        data = secret.get("data") or {}
        env_var = _PROVIDER_ENV_VARS.get(str(data.get("kind", "")).lower())
        key = (data.get("provider") or {}).get("key")
        if env_var and key:
            env.setdefault(env_var, key)
    return env
