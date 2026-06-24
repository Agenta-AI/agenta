"""Agenta agent runtime: run a coding harness (Pi, Claude, ...) as a swappable port.

Layers (Agenta's hexagonal vocabulary):

- ``dtos.py`` — data contracts (``AgentConfig``, ``SessionConfig``, ``Message``, ...).
- ``interfaces.py`` — the ports (ABCs): ``Backend``, ``Environment``, ``Sandbox``,
  ``Session``, ``Harness``.
- ``adapters/`` — implementations: ``SandboxAgentBackend`` / ``LocalBackend``
  and ``PiHarness`` / ``ClaudeHarness``.
- ``utils/`` — shared plumbing (the ``/run`` wire and the transports to the TS runner).

Standalone usage::

    import agenta as ag
    from agenta.sdk.agents import Message

    cfg = ag.ConfigManager.get_from_registry(app_slug="my-agent")
    agent = ag.AgentConfig.from_params(cfg)
    harness = ag.PiHarness(ag.Environment(ag.SandboxAgentBackend()))
    result = await harness.prompt(ag.SessionConfig(agent=agent), [Message(role="user", content="hi")])
"""

from .adapters import (
    AgentaHarness,
    ClaudeHarness,
    LocalBackend,
    PiHarness,
    SandboxAgentBackend,
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
from .errors import (
    AgentRunnerConfigurationError,
    ToolResolutionError,
    UnsupportedHarnessError,
)
from .interfaces import (
    Backend,
    Environment,
    Harness,
    NoopSessionStore,
    Sandbox,
    Session,
    SessionStore,
)
from .mcp import (
    MCPConfigurationError,
    MCPError,
    MCPResolver,
    MCPServerConfig,
    MissingMCPSecretError,
    ResolvedMCPServer,
)
from .skills import (
    SkillConfig,
    SkillConfigurationError,
    SkillError,
    SkillFile,
    parse_skill_config,
    parse_skill_configs,
    skill_to_wire,
    skills_to_wire,
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
)
from .adapters.vercel import (
    from_ui_messages,
    to_ui_message,
    ui_message_stream,
)

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
    # Former flat Vercel adapter names (compatibility; new code uses adapters.vercel)
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
    # Skills are a sibling subsystem
    "SkillConfig",
    "SkillFile",
    "parse_skill_config",
    "parse_skill_configs",
    "skill_to_wire",
    "skills_to_wire",
    "SkillError",
    "SkillConfigurationError",
    # Interfaces (ports)
    "Backend",
    "Sandbox",
    "Session",
    "SessionStore",
    "NoopSessionStore",
    "Environment",
    "Harness",
    # Errors
    "AgentRunnerConfigurationError",
    "UnsupportedHarnessError",
    "ToolResolutionError",
    # Adapters
    "SandboxAgentBackend",
    "LocalBackend",
    "PiHarness",
    "ClaudeHarness",
    "AgentaHarness",
    "make_harness",
]
