"""Gateway tool resolver: now lives in the SDK platform package.

Kept as a thin re-export so existing service imports
(``from oss.src.agent.tools import AgentaGatewayToolResolver``) keep working. The
implementation moved to ``agenta.sdk.agents.platform.gateway`` so a standalone SDK user with
a local backend resolves gateway tools the same way the service does.
"""

from agenta.sdk.agents.platform.gateway import (
    AgentaGatewayToolResolver,
    _normalize_reference,
    _to_gateway_reference,
)

__all__ = [
    "AgentaGatewayToolResolver",
    "_to_gateway_reference",
    "_normalize_reference",
]
