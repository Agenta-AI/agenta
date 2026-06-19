"""Agenta agent runtime: run a coding harness (Pi, Claude, ...) as a swappable port.

Layers (Agenta's hexagonal vocabulary):

- ``dtos.py`` — data contracts (``AgentConfig``, ``SessionConfig``, ``Message``, ...).
- ``interfaces.py`` — the ports (ABCs): ``Backend``, ``Environment``, ``Sandbox``,
  ``Session``, ``Harness``.
- ``adapters/`` — implementations: ``RivetBackend`` / ``InProcessPiBackend`` / ``LocalBackend``
  and ``PiHarness`` / ``ClaudeHarness``.
- ``utils/`` — shared plumbing (the ``/run`` wire and the transports to the TS runner).

Standalone usage::

    import agenta as ag
    from agenta.sdk.agents import Message

    cfg = ag.ConfigManager.get_from_registry(app_slug="my-agent")
    agent = ag.AgentConfig.from_params(cfg)
    harness = ag.PiHarness(ag.Environment(ag.RivetBackend()))
    result = await harness.prompt(ag.SessionConfig(agent=agent), [Message(role="user", content="hi")])
"""

from .adapters import (
    AgentaHarness,
    ClaudeHarness,
    InProcessPiBackend,
    LocalBackend,
    PiHarness,
    RivetBackend,
    make_harness,
)
from .dtos import (
    AgentaAgentConfig,
    AgentConfig,
    AgentEvent,
    AgentResult,
    ClaudeAgentConfig,
    ContentBlock,
    HarnessAgentConfig,
    HarnessCapabilities,
    HarnessType,
    Message,
    PermissionPolicy,
    PiAgentConfig,
    RunSelection,
    SessionConfig,
    ToolCallback,
    TraceContext,
    to_messages,
)
from .errors import ToolResolutionError, UnsupportedHarnessError
from .interfaces import Backend, Environment, Harness, Sandbox, Session
from .mcp import (
    MCPConfigurationError,
    MCPError,
    MCPResolver,
    MCPServerConfig,
    MissingMCPSecretError,
    ResolvedMCPServer,
)
from .streaming import AgentRun
from .tools import (
    BuiltinToolConfig,
    CallbackToolSpec,
    ClientToolConfig,
    ClientToolSpec,
    CodeToolConfig,
    CodeToolSpec,
    DuplicateToolNameError,
    EnvironmentToolSecretProvider,
    GatewayToolResolver,
    GatewayToolConfig,
    GatewayToolResolution,
    GatewayToolResolutionError,
    MissingSecretPolicy,
    MissingToolSecretError,
    ResolvedToolSet,
    ToolConfig,
    ToolConfigError,
    ToolConfigurationError,
    ToolError,
    ToolResolver,
    ToolSecretProvider,
    ToolSpec,
    UnsupportedToolProviderError,
    coerce_tool_config,
    coerce_tool_configs,
    parse_tool_config,
    parse_tool_configs,
)
from .ui_messages import from_ui_messages, to_ui_message, ui_message_stream

__all__ = [
    # DTOs
    "AgentConfig",
    "RunSelection",
    "SessionConfig",
    "HarnessAgentConfig",
    "PiAgentConfig",
    "ClaudeAgentConfig",
    "AgentaAgentConfig",
    "HarnessType",
    "HarnessCapabilities",
    "ContentBlock",
    "Message",
    "to_messages",
    "AgentEvent",
    "AgentResult",
    "AgentRun",
    # UI message codec (the /messages egress adapter)
    "from_ui_messages",
    "to_ui_message",
    "ui_message_stream",
    "TraceContext",
    "ToolCallback",
    "PermissionPolicy",
    # Canonical tools API
    "ToolConfig",
    "BuiltinToolConfig",
    "GatewayToolConfig",
    "CodeToolConfig",
    "ClientToolConfig",
    "ToolSpec",
    "CallbackToolSpec",
    "CodeToolSpec",
    "ClientToolSpec",
    "ResolvedToolSet",
    "GatewayToolResolution",
    "ToolResolver",
    "ToolSecretProvider",
    "GatewayToolResolver",
    "EnvironmentToolSecretProvider",
    "MissingSecretPolicy",
    "parse_tool_config",
    "parse_tool_configs",
    "coerce_tool_config",
    "coerce_tool_configs",
    "ToolError",
    "ToolConfigError",
    "ToolConfigurationError",
    "GatewayToolResolutionError",
    "UnsupportedToolProviderError",
    "MissingToolSecretError",
    "DuplicateToolNameError",
    # MCP is a sibling subsystem
    "MCPServerConfig",
    "ResolvedMCPServer",
    "MCPResolver",
    "MCPError",
    "MCPConfigurationError",
    "MissingMCPSecretError",
    # Interfaces (ports)
    "Backend",
    "Sandbox",
    "Session",
    "Environment",
    "Harness",
    # Errors
    "UnsupportedHarnessError",
    "ToolResolutionError",
    # Adapters
    "RivetBackend",
    "InProcessPiBackend",
    "LocalBackend",
    "PiHarness",
    "ClaudeHarness",
    "AgentaHarness",
    "make_harness",
]
