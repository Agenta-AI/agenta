"""Resolve provider API keys from the project vault into harness env vars.

The agent authenticates the harness with the same provider keys the project configured for
LLM access. We fetch the project's vault ``provider_key`` secrets from the backend (the
same backend + caller credential the tool resolver uses) and inject each as its standard
env var, so the harness uses whichever its model needs. Empty when the vault has none, in
which case the harness falls back to its own login / OAuth (see ``runRivet``).
"""

from typing import Dict

import httpx

from agenta.sdk.utils.logging import get_module_logger

from oss.src.agent.client import (
    TOOLS_TIMEOUT,
    agenta_api_base,
    request_authorization,
)

log = get_module_logger(__name__)

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


async def resolve_harness_secrets() -> Dict[str, str]:
    """Fetch the project vault's provider keys as ``{ENV_VAR: key}``. Best-effort.

    The SDK's per-request secret context does not propagate to this custom route, so we
    resolve here rather than reading it.
    """
    api_base = agenta_api_base()
    if not api_base:
        return {}
    headers = {"Content-Type": "application/json"}
    authorization = request_authorization()
    if authorization:
        headers["Authorization"] = authorization

    try:
        async with httpx.AsyncClient(timeout=TOOLS_TIMEOUT) as client:
            response = await client.get(f"{api_base}/secrets/", headers=headers)
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
