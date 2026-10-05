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

import httpx

from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)


class GatewayCredentialsError(RuntimeError):
    """The backend would not issue a gateway-confined credential for this caller.

    Raised rather than degraded to ``None``: falling back to the caller's own credential is
    exactly the defect the exchange exists to remove, and a run with no credential at all
    fails later with a message that names the wrong cause.

    ``failure_code`` carries the gateway's own code when the refusal named one. One value has
    a caller that acts on it: ``mcp_gateway_disabled`` means the deployment does not serve the
    MCP gateway, which is a reason to dial the declared servers directly rather than to fail
    the run. Everything else stays a failure.
    """

    def __init__(
        self,
        message: str,
        *,
        failure_code: Optional[str] = None,
        status_code: Optional[int] = None,
    ) -> None:
        super().__init__(message)
        self.failure_code = failure_code
        self.status_code = status_code


# Budget for one backend round-trip (the tool catalog/connection check, the vault fetch).
# Gateway tool resolution can call out to a provider (e.g. Composio) and exceed a few seconds,
# so 5s was too tight and surfaced as a ReadTimeout -> failed run. Default 30s, env-overridable.
DEFAULT_TOOLS_TIMEOUT = 30.0


def default_timeout() -> float:
    """The backend round-trip budget (seconds). Override via AGENTA_AGENT_TOOLS_TIMEOUT."""
    raw = os.getenv("AGENTA_AGENT_TOOLS_TIMEOUT")
    if raw:
        try:
            return float(raw)
        except ValueError:
            pass
    return DEFAULT_TOOLS_TIMEOUT


def _refusal_code(response: httpx.Response) -> Optional[str]:
    """The gateway's own ``code`` out of a refusal, when the body carries the shared envelope.

    Tolerant on purpose: this runs on an error path, and a body that is not JSON, not a dict,
    or not enveloped simply yields ``None``, leaving the caller with the status it already
    had. The envelope arrives under ``detail`` because FastAPI wraps an ``HTTPException``.
    """
    try:
        body = response.json()
    except Exception:  # pylint: disable=broad-except
        return None

    detail = body.get("detail") if isinstance(body, dict) else None
    code = detail.get("code") if isinstance(detail, dict) else None
    return code if isinstance(code, str) and code else None


def _derive_base_url() -> Optional[str]:
    """Resolve the Agenta backend base URL (``.../api``).

    Derives it from the OTLP endpoint the SDK is configured with
    (``{host}/api/otlp/v1/traces``), then falls back to ``AGENTA_API_URL``. Returns ``None``
    when nothing is configured; callers only need this when tools or secrets apply.
    """
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

    # Fall back to the full (scheme-tagged) credential — used verbatim. The sandbox is
    # handed an ephemeral `Secret ...` here when no bare API key exists.
    credentials = os.getenv("AGENTA_CREDENTIALS")
    if credentials:
        return credentials

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

    def gateway_base_url(self) -> Optional[str]:
        """The base URL the gateway route is composed against (D30's ``{gateway_base}``).

        The gateways mount inside the API app under ``/gateways/...``, so this IS the API
        base. It stays a named accessor rather than a concatenation at each call site: a
        gateway hosted separately would change this body and nothing else.

        The PUBLIC base, and that is the whole difference from :meth:`base_url`. Every caller
        of this composes an address that is written INTO a sandbox: the MCP relay URL and the
        LLM gateway endpoint. ``base_url`` prefers ``AGENTA_API_INTERNAL_URL`` because the
        calls THIS process makes (the credential exchange, the vault) want the in-network hop,
        and a remote sandbox has no route to ``http://api:8000`` at all. Handed one anyway, a
        Daytona run refuses before it starts, on the runner's HTTPS check.

        Read through the SDK's own ``parse_url``, the same reader the trace endpoint a
        dispatched run carries already goes through, so a self-hoster's ``localhost`` public
        base becomes ``host.docker.internal`` here exactly as it does there. With no public
        base configured this falls back to :meth:`base_url`, which is the offline and
        standalone case and is unchanged.
        """
        if self._base_url:
            return self._base_url

        public = (os.getenv("AGENTA_API_URL") or "").strip()
        if public:
            # Lazily, like the rest of this module: importing it at module scope would run
            # ``agenta``'s own import before the singleton exists.
            from agenta.sdk.utils.helpers import parse_url

            return parse_url(url=public).rstrip("/")

        return self.base_url()

    def authorization(self) -> Optional[str]:
        """The caller's Authorization: explicit, else the per-request context, else env key."""
        return self._authorization or _derive_authorization()

    async def gateway_authorization(
        self,
        *,
        plane: Optional[str] = None,
        session_id: Optional[str] = None,
        agent_id: Optional[str] = None,
    ) -> Optional[str]:
        """The credential the SANDBOX may hold, exchanged for the one this process holds.

        `authorization()` is the runtime's general-purpose credential: it reads the vault,
        commits workflows and resolves tools, and the gateway exists precisely so nothing
        with that reach travels into a sandbox. This asks the backend for a second value
        with the same tenant scope and the same run, no grants, and an audience the API
        accepts only on the gateway data plane.

        ``plane`` names which gateway the credential is for, ``"llm"`` or ``"mcp"``. The
        credential itself is the same either way; naming the plane is what lets the API say
        that plane is switched off now, while the caller still has a pre-gateway path, rather
        than at the first tool call, when it does not.

        ``session_id`` and ``agent_id`` label the platform-funded usage the gateway records
        for calls made with this credential. They authorize nothing.

        ``None`` when no backend or no caller credential is configured — the offline and
        standalone cases, where there is no gateway to be confined to either.
        """
        api_base = self.base_url()
        authorization = self.authorization()
        if not api_base or not authorization:
            return None

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{api_base}/gateways/credentials",
                    headers=self.headers(authorization=authorization),
                    json={
                        key: value
                        for key, value in (
                            ("plane", plane),
                            ("session_id", session_id),
                            ("agent_id", agent_id),
                        )
                        if value
                    },
                )
        except Exception as exc:  # pylint: disable=broad-except
            log.warning("agent: gateway credential exchange failed", exc_info=True)
            raise GatewayCredentialsError(
                "gateway credential exchange request failed"
            ) from exc

        if response.status_code >= 400:
            log.warning(
                "agent: gateway credential exchange HTTP %s", response.status_code
            )
            raise GatewayCredentialsError(
                f"gateway credential exchange refused with HTTP {response.status_code}",
                failure_code=_refusal_code(response),
                status_code=response.status_code,
            )

        try:
            data = response.json() or {}
        except Exception as exc:  # pylint: disable=broad-except
            raise GatewayCredentialsError(
                "gateway credential exchange returned an unreadable response"
            ) from exc

        credentials = data.get("credentials") if isinstance(data, dict) else None
        if not isinstance(credentials, str) or not credentials:
            raise GatewayCredentialsError(
                "gateway credential exchange returned no credential"
            )

        return credentials

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
