"""Agenta-platform-backed adapters for agent tool/secret resolution.

This package holds the implementations that reach the Agenta backend over HTTP: the
:class:`PlatformConnection` (base URL + per-call auth), the gateway tool resolver, the
named-secret provider, and the provider-key fetch, plus the three resolution entrypoints
(:func:`resolve_tools`, :func:`resolve_mcp`, :func:`resolve_secrets`). The pure resolution
framework and the neutral models stay in ``agenta.sdk.agents.tools``; only the platform-bound
code lives here.

Kept out of ``agenta.sdk.agents.__init__`` eager exports on purpose: these modules reach
into ``agenta``/the SDK singleton, so importing them lazily (``from agenta.sdk.agents.platform
import ...``) avoids re-entering ``agenta``'s own import.
"""

from .connection import PlatformConnection, default_timeout
from .gateway import AgentaGatewayToolResolver
from .resolve import resolve_mcp, resolve_secrets, resolve_tools
from .secrets import (
    AgentaNamedSecretProvider,
    resolve_named_secrets,
    resolve_provider_keys,
)

__all__ = [
    "PlatformConnection",
    "default_timeout",
    "AgentaGatewayToolResolver",
    "AgentaNamedSecretProvider",
    "resolve_named_secrets",
    "resolve_provider_keys",
    "resolve_tools",
    "resolve_mcp",
    "resolve_secrets",
]
