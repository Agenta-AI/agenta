"""Agenta-platform-backed secret resolution.

Two distinct vault reads, both best-effort (an outage returns empty rather than failing the
run, since a project with no secret-bearing tools still runs):

- `resolve_named_secrets` (`GET /secrets/{slug}`): named secret values for code-tool and
  MCP environments, resolved by explicit slug. Pairs with the resolver's
  `MissingSecretPolicy.ERROR`, so a tool whose declared secret is absent then hard-fails.
- `resolve_provider_keys` (`GET /secrets/`): the project's LLM provider keys, mapped to the
  env vars a harness reads. Optional by design: when the vault has none, the harness falls
  back to its own login/OAuth, so self-managed Pi/Claude sidecars keep working.

Logs never include secret names or values, only counts.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional, Sequence
from urllib.parse import quote

import httpx

from agenta.sdk.utils.logging import get_module_logger

from ..capabilities import PROVIDER_ENV_VARS
from .connection import PlatformConnection

log = get_module_logger(__name__)


async def resolve_named_secrets(
    names: Sequence[str],
    *,
    connection: Optional[PlatformConnection] = None,
) -> Dict[str, str]:
    """Resolve text project secrets by slug for tool and MCP environments. Best-effort."""
    if not names:
        return {}

    connection = connection or PlatformConnection()
    api_base = connection.base_url()
    if not api_base:
        return {}

    requested = list(dict.fromkeys(str(name) for name in names))
    resolved: Dict[str, str] = {}
    headers = connection.headers()

    async with httpx.AsyncClient(timeout=connection.timeout) as client:
        for name in requested:
            try:
                response = await client.get(
                    f"{api_base}/secrets/{quote(name, safe='')}",
                    headers=headers,
                )
                if response.status_code == 404:
                    continue
                if response.status_code >= 400:
                    log.warning(
                        "agent: named-secret read HTTP %s", response.status_code
                    )
                    continue
                value = _text_custom_secret_value(response.json())
                if value is not None:
                    resolved[name] = value
            except Exception:  # pylint: disable=broad-except
                log.warning("agent: named-secret read failed", exc_info=True)

    missing_count = len(requested) - len(resolved)
    if missing_count:
        log.warning("agent: %d named secret(s) unresolved", missing_count)
    return resolved


def _text_custom_secret_value(payload: Any) -> Optional[str]:
    """Extract only the vault shape MCP headers can safely consume."""
    if not isinstance(payload, dict) or payload.get("kind") != "custom_secret":
        return None
    data = payload.get("data")
    secret = data.get("secret") if isinstance(data, dict) else None
    if not isinstance(secret, dict) or secret.get("format") != "text":
        return None
    content = secret.get("content")
    return content if isinstance(content, str) else None


class AgentaNamedSecretProvider:
    """`ToolSecretProvider` backed by the Agenta vault's named-secret resolver."""

    def __init__(self, connection: Optional[PlatformConnection] = None) -> None:
        self._connection = connection or PlatformConnection()

    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        return await resolve_named_secrets(names, connection=self._connection)


# Canonical map lives in capabilities.py; this alias keeps the local name callers already use.
_PROVIDER_ENV_VARS = PROVIDER_ENV_VARS


async def resolve_provider_keys(
    *,
    connection: Optional[PlatformConnection] = None,
) -> Dict[str, str]:
    """Fetch the project vault's provider keys as ``{ENV_VAR: key}``. Best-effort, optional.

    Empty when the vault has none, in which case the harness falls back to its own
    login/OAuth (self-managed Pi/Claude sidecars), so absence is valid, never an error.

    DEPRECATED: this is the model-blind whole-vault dump (it injects *every* provider key the
    project holds, ignoring which model/connection the run actually uses, and never reads
    ``custom_provider`` secrets). It is superseded by
    :func:`agenta.sdk.agents.platform.resolve_connection` /
    :class:`agenta.sdk.agents.platform.VaultConnectionResolver`, which resolve exactly one
    least-privilege connection and fail loud. The agent ``/invoke`` path no longer calls it —
    ``services/oss/src/agent/app.py`` resolves one connection via ``resolve_connection``. It is
    kept callable only for the deprecated re-export in ``services/oss/src/agent/secrets.py`` and
    its integration test; removing both (and this function) is Slice 3.
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
        kind = str(data.get("kind", "")).lower()
        env_var = _PROVIDER_ENV_VARS.get(kind)
        key = (data.get("provider") or {}).get("key")
        if env_var and key:
            env.setdefault(env_var, key)
        elif kind and not env_var:
            log.warning("agent: vault provider kind %r has no known env var", kind)
    return env
