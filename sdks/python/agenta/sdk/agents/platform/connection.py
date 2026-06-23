"""How agent tool/secret resolution reaches the Agenta backend.

:class:`PlatformConnection` carries the base URL and the per-call authorization that the
platform-backed resolvers (gateway tools, named secrets, provider keys) use. It exists so
the Agenta service and a standalone SDK user resolve against the platform the same way.

Two halves, deliberately sourced differently (see the agent-workflows tool-resolution plan,
decision D4):

- **Base URL** is global: the same Agenta backend for every caller. It may be set explicitly
  or derived from the SDK's configured host (the OTLP endpoint) or env.
- **Authorization** is per-call and must come from the caller's request context, never a
  process-global, so in the shared service one caller's credential never leaks into
  another's run. Resolution order: an explicit value, then the per-request tracing
  propagation, then the process API key as a last-resort fallback (the standalone-SDK case,
  where the env key is the user's own).

``agenta`` is imported lazily inside the helpers, never at module import time, so this module
stays safe to import before the SDK singleton exists (it must not re-enter ``agenta``'s own
import).
"""

from __future__ import annotations

import os
from typing import Dict, Optional

from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)

# Budget for one backend round-trip (the tool catalog/connection check, the vault fetch).
DEFAULT_TOOLS_TIMEOUT = 30.0


def default_timeout() -> float:
    """The configured backend round-trip budget, guarded against a malformed env value."""
    raw = os.getenv("AGENTA_AGENT_TOOLS_TIMEOUT")
    if raw is None:
        return DEFAULT_TOOLS_TIMEOUT
    try:
        return float(raw)
    except ValueError:
        log.warning(
            "agent: invalid AGENTA_AGENT_TOOLS_TIMEOUT %r; using %s",
            raw,
            DEFAULT_TOOLS_TIMEOUT,
        )
        return DEFAULT_TOOLS_TIMEOUT


def _derive_base_url() -> Optional[str]:
    """Resolve the Agenta backend base URL (``.../api``).

    Prefers an explicit override, then derives it from the OTLP endpoint the SDK is
    configured with (``{host}/api/otlp/v1/traces``), then falls back to env. Returns ``None``
    when nothing is configured; callers only need this when tools or secrets apply.
    """
    override = os.getenv("AGENTA_AGENT_TOOLS_API_URL")
    if override:
        return override.rstrip("/")

    try:
        import agenta as ag

        otlp_url = ag.tracing.otlp_url
    except Exception:  # pylint: disable=broad-except
        otlp_url = None
    if otlp_url and "/otlp/" in otlp_url:
        return otlp_url.split("/otlp/", 1)[0].rstrip("/")

    api_url = os.getenv("AGENTA_API_URL")
    if api_url:
        return api_url.rstrip("/")

    return None


def _derive_authorization() -> Optional[str]:
    """The project-scoped credential to call the Agenta backend, per request.

    Reuses the same propagation the OTLP credential rides on (the caller's Authorization),
    falling back to the process API key the way the tracing sidecar does. Scoping to the
    caller keeps an agent run from invoking tools the user could not.
    """
    try:
        from agenta.sdk.engines.tracing.propagation import inject

        authorization = inject({}).get("Authorization")
    except Exception:  # pylint: disable=broad-except
        authorization = None
    if authorization:
        return authorization

    api_key = os.getenv("AGENTA_API_KEY")
    if api_key:
        return f"ApiKey {api_key}"

    return None


class PlatformConnection:
    """Base URL + per-call authorization for the platform-backed resolvers.

    Construct with no arguments to resolve everything from the ambient SDK config and the
    per-request context (the service and standalone defaults). Pass ``base_url`` /
    ``authorization`` to pin them explicitly (tests, or an SDK user wiring their own values).
    Both are resolved lazily on each access, never cached, so a long-lived connection used
    across many requests always reflects the current caller's context.
    """

    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        authorization: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> None:
        self._base_url = base_url.rstrip("/") if base_url else None
        self._authorization = authorization
        self._timeout = timeout

    @property
    def timeout(self) -> float:
        return self._timeout if self._timeout is not None else default_timeout()

    def base_url(self) -> Optional[str]:
        """The backend base URL: explicit, else derived from SDK config/env. ``None`` if unset."""
        return self._base_url or _derive_base_url()

    def authorization(self) -> Optional[str]:
        """The caller's Authorization: explicit, else the per-request context, else env key."""
        return self._authorization or _derive_authorization()

    def headers(
        self, *, json: bool = True, authorization: Optional[str] = None
    ) -> Dict[str, str]:
        """Request headers for a backend call: content type plus Authorization when present.

        Pass ``authorization`` to reuse a value the caller already resolved (so a request
        header and, e.g., a ``ToolCallback`` carry the same credential from one resolution);
        omit it to resolve the per-request credential here.
        """
        headers: Dict[str, str] = {}
        if json:
            headers["Content-Type"] = "application/json"
        authorization = (
            authorization if authorization is not None else self.authorization()
        )
        if authorization:
            headers["Authorization"] = authorization
        return headers
