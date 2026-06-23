"""Access to the Agenta backend from inside a harness run.

Resolving the backend base URL and the caller-scoped credential is shared by the tool
resolver and the secret resolver, so it lives here. The credential reuses the same
propagation the OTLP export rides on, so an agent run calls ``/tools/resolve``,
``/tools/call``, and ``/secrets/`` as the caller, not with broader rights.
"""

import os
from typing import Optional

import agenta as ag
from agenta.sdk.engines.tracing.propagation import inject

# Budget for a backend round-trip (the tool catalog/connection check, the vault fetch).
TOOLS_TIMEOUT = float(os.getenv("AGENTA_AGENT_TOOLS_TIMEOUT", "30"))


def agenta_api_base() -> Optional[str]:
    """Resolve the Agenta backend base URL (``.../api``).

    Prefers an explicit override, then derives it from the OTLP endpoint the SDK is
    configured with (``{host}/api/otlp/v1/traces``), then falls back to env. Returns
    ``None`` when nothing is configured; callers only need this when tools or secrets apply.
    """
    override = os.getenv("AGENTA_AGENT_TOOLS_API_URL")
    if override:
        return override.rstrip("/")

    try:
        otlp_url = ag.tracing.otlp_url
    except Exception:  # pylint: disable=broad-except
        otlp_url = None
    if otlp_url and "/otlp/" in otlp_url:
        return otlp_url.split("/otlp/", 1)[0].rstrip("/")

    api_url = os.getenv("AGENTA_API_URL")
    if api_url:
        return api_url.rstrip("/")

    return None


def request_authorization() -> Optional[str]:
    """The project-scoped credential to call the Agenta backend.

    Reuses the same propagation the OTLP credential rides on (the caller's Authorization),
    falling back to the service's own API key the way the tracing sidecar does. Scoping to
    the caller keeps an agent run from invoking tools the user could not (WP-7 risk:
    RUN_TOOLS scoping).
    """
    try:
        authorization = inject({}).get("Authorization")
    except Exception:  # pylint: disable=broad-except
        authorization = None
    if authorization:
        return authorization

    api_key = os.getenv("AGENTA_API_KEY")
    if api_key:
        return f"ApiKey {api_key}"

    return None
