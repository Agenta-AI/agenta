"""Public MCP configuration and resolution API."""

from .errors import (
    MCPConfigurationError,
    MCPError,
    MCPGatewayUnavailableError,
    MCPServerURLBlockedError,
    MissingMCPSecretError,
)
from .interfaces import MCPSecretProvider
from .models import (
    HeaderCredentialBinding,
    MCPConnection,
    MCPGatewayConnection,
    MCPHeaderSecretRefs,
    MCPPolicy,
    MCPServerConfig,
    MCPServerConnection,
    MCPToolPolicy,
    NoMCPCredentials,
    ResolvedMCPCredential,
    ResolvedMCPServer,
)
from .parsing import parse_mcp_server_config, parse_mcp_server_configs
from .resolver import MCPResolver
from .wire import mcp_server_to_wire, mcp_servers_to_wire

__all__ = [
    "MCPServerConfig",
    "MCPConnection",
    "MCPGatewayConnection",
    "MCPServerConnection",
    "MCPHeaderSecretRefs",
    "MCPPolicy",
    "MCPToolPolicy",
    "NoMCPCredentials",
    "HeaderCredentialBinding",
    "ResolvedMCPCredential",
    "ResolvedMCPServer",
    "MCPSecretProvider",
    "MCPResolver",
    "parse_mcp_server_config",
    "parse_mcp_server_configs",
    "mcp_server_to_wire",
    "mcp_servers_to_wire",
    "MCPError",
    "MCPConfigurationError",
    "MCPServerURLBlockedError",
    "MCPGatewayUnavailableError",
    "MissingMCPSecretError",
]
