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

import asyncio
from typing import Any, Dict, Mapping, Optional, Sequence
from urllib.parse import quote

import httpx

from agenta.sdk.utils.logging import get_module_logger

from ..capabilities import PROVIDER_ENV_VARS
from ..connections.credentials import secret_value_configured
from .connection import PlatformConnection

log = get_module_logger(__name__)

# How many named-secret reads one call keeps in flight.
_READ_CONCURRENCY = 8


async def resolve_named_secrets(
    names: Sequence[str],
    *,
    connection: Optional[PlatformConnection] = None,
    scope: Optional[str] = None,
) -> Dict[str, str]:
    """Resolve text secrets by slug for tool and MCP environments. Best-effort.

    The project's secrets, or with ``scope="organization"`` the organization secrets
    available to the run's project (an agent's ``namespace: "organization"``)."""
    if not names:
        return {}

    connection = connection or PlatformConnection()
    api_base = connection.base_url()
    if not api_base:
        return {}

    requested = list(dict.fromkeys(str(name) for name in names))
    headers = connection.headers()

    # Bounded so a long list cannot wait out the client's pool and read as missing.
    semaphore = asyncio.Semaphore(_READ_CONCURRENCY)

    async def _read(client: httpx.AsyncClient, name: str) -> Optional[str]:
        async with semaphore:
            return await _read_one(client, name)

    async def _read_one(client: httpx.AsyncClient, name: str) -> Optional[str]:
        try:
            response = await client.get(
                f"{api_base}/secrets/{quote(name, safe='')}",
                headers=headers,
                **({"params": {"scope": scope}} if scope else {}),
            )
            if response.status_code == 404:
                return None
            if response.status_code >= 400:
                log.warning("agent: named-secret read HTTP %s", response.status_code)
                return None
            payload = response.json()
            value = _text_custom_secret_value(payload)
            if value is None and _is_write_only_redacted(payload):
                # Engineering copy; adjust freely. No secret name in the log (module
                # policy above); the caller knows which names it requested.
                log.error(
                    "agent: a requested named secret is write-only: its value "
                    "cannot be read back outside the platform runtime. For "
                    "standalone runs, set the value directly in the tool's "
                    "environment configuration instead."
                )
            return value
        except Exception:  # pylint: disable=broad-except
            log.warning("agent: named-secret read failed", exc_info=True)
            return None

    # One read per name, up to `_READ_CONCURRENCY` at once: each one swallows its own failure.
    async with httpx.AsyncClient(timeout=connection.timeout) as client:
        values = await asyncio.gather(*(_read(client, name) for name in requested))
    resolved: Dict[str, str] = {
        name: value for name, value in zip(requested, values) if value is not None
    }

    missing_count = len(requested) - len(resolved)
    if missing_count:
        log.warning("agent: %d named secret(s) unresolved", missing_count)
    return resolved


async def resolve_user_secrets(
    item_keys: Sequence[str],
    *,
    connection: Optional[PlatformConnection] = None,
) -> Dict[str, str]:
    """The run person's own secret values for these ``secret:user/<variable>`` item
    keys, in ONE call (``POST /secrets/resolve``), read from the run's own claim.
    Best-effort: a key with no value is left out, and an outage resolves nothing."""
    if not item_keys:
        return {}
    connection = connection or PlatformConnection()
    api_base = connection.base_url()
    if not api_base:
        return {}
    try:
        async with httpx.AsyncClient(timeout=connection.timeout) as client:
            response = await client.post(
                f"{api_base}/secrets/resolve",
                headers=connection.headers(),
                json={"item_keys": list(dict.fromkeys(item_keys))},
            )
        if response.status_code >= 400:
            log.warning("agent: user-secret read HTTP %s", response.status_code)
            return {}
        payload = response.json() or {}
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: user-secret read failed", exc_info=True)
        return {}
    resolved: Dict[str, str] = {}
    for entry in payload.get("item_secrets") or []:
        if not isinstance(entry, dict):
            continue
        value = _text_custom_secret_value(entry.get("secret"))
        if isinstance(entry.get("item_key"), str) and value is not None:
            resolved[entry["item_key"]] = value
    missing_count = len(set(item_keys)) - len(resolved)
    if missing_count:
        log.info("agent: %d user secret(s) not set up; left out", missing_count)
    return resolved


def _is_write_only_redacted(payload: Any) -> bool:
    """Whether the vault says a value exists but redacted it for this caller."""
    return (
        isinstance(payload, dict)
        and bool(payload.get("write_only"))
        and secret_value_configured(payload)
    )


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
