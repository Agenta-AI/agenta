"""Offline, SDK-default connection resolvers.

Two adapters that need no service and no network, mirroring the sdk-local-tools
``SecretResolver`` precedent:

- :class:`EnvConnectionResolver`: read the requested provider's api key from the process env
  (``OPENAI_API_KEY`` etc.), the standalone-SDK default.
- :class:`StaticConnectionResolver`: a bring-your-own adapter the SDK user constructs with an
  explicit credential.

The connected ``VaultConnectionResolver`` reads the platform ``GET /secrets/`` endpoint and
does NOT live here (this module imports no service code, stays offline).
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

from ..capabilities import PROVIDER_ENV_VARS
from .errors import UnsupportedProviderError
from .models import (
    Endpoint,
    ModelRef,
    ResolvedConnection,
    RuntimeAuthContext,
)

# Canonical map lives in capabilities.py; this alias keeps the local name callers already use.
_PROVIDER_ENV_VARS: Dict[str, str] = PROVIDER_ENV_VARS


class EnvConnectionResolver:
    """Read the requested provider's api key from the current process environment.

    - ``Connection.mode == self_managed`` -> ``credential_mode = runtime_provided``, empty
      ``env`` (the harness owns auth).
    - ``agenta`` (the default mode, with or without a slug) -> infer the provider (from
      ``ModelRef.provider``, else error), look up its env var, and:
        - present -> ``credential_mode = env`` carrying exactly that one var;
        - absent  -> ``credential_mode = runtime_provided`` with empty ``env`` (absence is
          valid; the harness falls back to its own login, matching today's semantics).

    The model passes through unchanged. Offline, no vault, no network.
    """

    def __init__(self, *, env: Optional[Dict[str, str]] = None) -> None:
        # Default to the live process env; an injected mapping makes the resolver testable.
        self._env = env if env is not None else os.environ

    async def resolve(
        self,
        *,
        model: ModelRef,
        context: RuntimeAuthContext,
    ) -> ResolvedConnection:
        if model.connection.mode == "self_managed":
            return ResolvedConnection(
                provider=model.provider or "",
                model=model.model,
                credential_mode="runtime_provided",
                env={},
            )

        provider = model.provider
        if not provider:
            raise UnsupportedProviderError(
                provider="<unknown>",
                harness=context.harness,
            )

        env_var = _PROVIDER_ENV_VARS.get(provider.lower())
        key = self._env.get(env_var) if env_var else None
        if env_var and key:
            return ResolvedConnection(
                provider=provider,
                model=model.model,
                credential_mode="env",
                env={env_var: key},
            )
        # Absence is valid: inject nothing and let the harness use its own login/OAuth.
        return ResolvedConnection(
            provider=provider,
            model=model.model,
            credential_mode="runtime_provided",
            env={},
        )


class StaticConnectionResolver:
    """A bring-your-own resolver: the SDK user supplies one credential at construction.

    Construct it with an explicit api key (and optional base URL), or with a dict of the same
    fields. Every ``resolve`` returns a :class:`ResolvedConnection` built from those values,
    with the model carried through from the :class:`ModelRef`.
    """

    def __init__(
        self,
        *,
        provider: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        env_var: Optional[str] = None,
        deployment: str = "direct",
    ) -> None:
        self._provider = provider
        self._api_key = api_key
        self._base_url = base_url
        self._env_var = env_var
        self._deployment = deployment

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StaticConnectionResolver":
        """Build from a plain ``{provider, api_key, base_url, env_var, deployment}`` mapping."""
        return cls(
            provider=data.get("provider"),
            api_key=data.get("api_key"),
            base_url=data.get("base_url"),
            env_var=data.get("env_var"),
            deployment=data.get("deployment", "direct"),
        )

    async def resolve(
        self,
        *,
        model: ModelRef,
        context: RuntimeAuthContext,
    ) -> ResolvedConnection:
        provider = self._provider or model.provider or ""
        env: Dict[str, str] = {}
        if self._api_key:
            env_var = self._env_var or _PROVIDER_ENV_VARS.get(provider.lower())
            if env_var:
                env[env_var] = self._api_key
        endpoint = Endpoint(base_url=self._base_url) if self._base_url else None
        return ResolvedConnection(
            provider=provider,
            model=model.model,
            deployment=self._deployment,  # type: ignore[arg-type]
            credential_mode="env" if env else "runtime_provided",
            env=env,
            endpoint=endpoint,
        )
