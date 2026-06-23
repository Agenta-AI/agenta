"""Agenta-platform-backed connection resolution.

:class:`VaultConnectionResolver` is the service / connected-path :class:`ConnectionResolver`
adapter. It POSTs one :class:`ModelRef` plus the run's harness/backend to
``POST /vault/connections/resolve`` and parses the single least-privilege
:class:`ResolvedConnection` the backend returns (one provider's env vars, plus a non-secret
endpoint). It replaces the model-blind whole-vault dump in
:func:`agenta.sdk.agents.platform.secrets.resolve_provider_keys` (kept-but-deprecated until the
service migrates onto this path; see that module's docstring).

Unlike the dump, this resolver is **fail-loud**: a missing connection, an ambiguous match, a
provider mismatch, or any HTTP error raises a :class:`ConnectionResolutionError`. The design
(Concern 3, "Resolution rules") wants explicit errors, not a best-effort empty result that
silently runs with the wrong (or no) credential.

``agenta`` is never imported at module load (the lazy-import discipline of the rest of this
package); the auth/base-url plumbing rides :class:`PlatformConnection`, exactly like
:func:`resolve_named_secrets` / :func:`resolve_provider_keys`.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import httpx

from agenta.sdk.utils.logging import get_module_logger

from ..connections import (
    ConnectionResolutionError,
    Endpoint,
    ModelRef,
    ResolvedConnection,
    RuntimeAuthContext,
)
from .connection import PlatformConnection

log = get_module_logger(__name__)


class VaultConnectionResolver:
    """A :class:`ConnectionResolver` backed by ``POST /vault/connections/resolve``.

    Construct with no arguments to resolve auth/base-url from the ambient SDK config and the
    per-request context (the service default), or pass a pinned :class:`PlatformConnection`
    (tests, or an SDK user wiring explicit values). Every ``resolve`` is one HTTP round-trip
    that returns exactly one connection's credentials; the other connections, and every other
    provider's key, never enter the run.
    """

    def __init__(self, connection: Optional[PlatformConnection] = None) -> None:
        self._connection = connection or PlatformConnection()

    async def resolve(
        self,
        *,
        model: ModelRef,
        context: RuntimeAuthContext,
    ) -> ResolvedConnection:
        api_base = self._connection.base_url()
        if not api_base:
            # No backend configured: there is no vault to resolve against. Fail loud rather
            # than silently running with no credential (the old dump returned empty here).
            raise ConnectionResolutionError(
                "no Agenta backend configured for connection resolution"
            )

        body: Dict[str, Any] = {
            # The connection rides inside the ModelRef; project_id is NOT sent in the body
            # (the backend takes it from request context, design Security rule 1).
            "model": model.model_dump(mode="json"),
            "harness": context.harness,
        }
        if context.backend is not None:
            body["backend"] = context.backend

        try:
            async with httpx.AsyncClient(timeout=self._connection.timeout) as client:
                response = await client.post(
                    f"{api_base}/vault/connections/resolve",
                    json=body,
                    headers=self._connection.headers(),
                )
        except Exception as exc:  # pylint: disable=broad-except
            log.warning("agent: connection resolve request failed", exc_info=True)
            raise ConnectionResolutionError(
                "connection resolution request failed"
            ) from exc

        if response.status_code >= 400:
            log.warning(
                "agent: connection resolve HTTP %s for provider %r",
                response.status_code,
                model.provider,
            )
            raise ConnectionResolutionError(
                f"connection resolution failed (HTTP {response.status_code})"
            )

        data = response.json() or {}
        return _parse_resolved_connection(data)


def _parse_resolved_connection(data: Dict[str, Any]) -> ResolvedConnection:
    """Parse the resolve endpoint's JSON into a :class:`ResolvedConnection`.

    Tolerant of both ``credential_mode`` and the camelCase ``credentialMode`` (the API response
    schema uses snake_case fields, but the non-secret wire elsewhere is camelCase). The endpoint
    sub-object is parsed from either ``base_url``/``baseUrl`` style keys.
    """
    if not isinstance(data, dict):
        raise ConnectionResolutionError("connection resolution returned a non-object")

    endpoint_data = data.get("endpoint")
    endpoint: Optional[Endpoint] = None
    if isinstance(endpoint_data, dict) and endpoint_data:
        endpoint = Endpoint(
            base_url=endpoint_data.get("base_url") or endpoint_data.get("baseUrl"),
            api_version=endpoint_data.get("api_version")
            or endpoint_data.get("apiVersion"),
            region=endpoint_data.get("region"),
            headers=endpoint_data.get("headers") or {},
        )

    credential_mode = data.get("credential_mode") or data.get("credentialMode")
    env = data.get("env") or {}
    try:
        return ResolvedConnection(
            provider=data["provider"],
            model=data["model"],
            deployment=data.get("deployment", "direct"),
            credential_mode=credential_mode,
            env={str(k): str(v) for k, v in env.items()},
            endpoint=endpoint,
        )
    except (KeyError, ValueError) as exc:
        raise ConnectionResolutionError(
            "connection resolution returned a malformed response"
        ) from exc
