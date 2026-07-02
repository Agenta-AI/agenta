"""Agenta agent runtime: run a coding harness (Pi, Claude, ...) as a swappable port.

Layers (Agenta's hexagonal vocabulary):

- ``dtos.py`` — data contracts (``AgentTemplate``, ``SessionConfig``, ``Message``, ...).
- ``interfaces.py`` — the ports (ABCs): ``Backend``, ``Environment``, ``Sandbox``,
  ``Session``, ``Harness``.
- ``adapters/`` — implementations: ``SandboxAgentBackend`` / ``LocalBackend``
  and ``PiHarness`` / ``ClaudeHarness``.
- ``utils/`` — shared plumbing (the ``/run`` wire and the transports to the TS runner).

Standalone usage::

    import agenta as ag
    from agenta.sdk.agents import Message

    cfg = ag.ConfigManager.get_from_registry(app_slug="my-agent")
    agent = ag.AgentTemplate.from_params(cfg)
    harness = ag.PiHarness(ag.Environment(ag.SandboxAgentBackend()))
    result = await harness.prompt(ag.SessionConfig(agent=agent), [Message(role="user", content="hi")])
"""

from .adapters import (
    AgentaHarness,
    ClaudeHarness,
    LocalBackend,
    OpencodeHarness,
    PiHarness,
    SandboxAgentBackend,
    make_harness,
)
from .capabilities import (
    HARNESS_CONNECTION_CAPABILITIES,
    HarnessConnectionCapabilities,
    harness_allows_mode,
    harness_allows_provider,
)
from .connections import (
    AgentConnectionError,
    AmbiguousConnectionError,
    Connection,
    ConnectionNotFoundError,
    ConnectionResolutionError,
    ConnectionResolver,
    Endpoint,
    EnvConnectionResolver,
    MissingProviderError,
    ModelRef,
    ProviderMismatchError,
    ResolvedConnection,
    RuntimeAuthContext,
    StaticConnectionResolver,
    UnsupportedConnectionModeError,
    UnsupportedProviderError,
)
from .dtos import (
    AgentaAgentTemplate,
    AgentTemplate,
    Event,
    AgentResult,
    ClaudeAgentTemplate,
    ContentBlock,
    HARNESS_IDENTITIES,
    HarnessAgentTemplate,
    HarnessCapabilities,
    HarnessIdentity,
    HarnessType,
    Message,
    NetworkEgress,
    OpencodeAgentTemplate,
    PermissionPolicy,
    PiAgentTemplate,
    RunContext,
    RunContextReference,
    RunContextTrace,
    RunContextWorkflow,
    SandboxPermission,
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
    Sandbox,
    Session,
)
from .mcp import (
    MCPConfigurationError,
    MCPDisabledError,
    MCPError,
    MCPResolver,
    MCPServerConfig,
    MissingMCPSecretError,
    ResolvedMCPServer,
)
from .skills import (
    SkillTemplate,
    SkillValidationError,
    SkillError,
    SkillFile,
    parse_skill_template,
    parse_skill_templates,
    skill_to_wire,
    skills_to_wire,
)
from .streaming import AgentStream
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
    PlatformToolConfig,
    ReferenceToolConfig,
    ResolvedToolSet,
    ToolCall,
    ToolConfig,
    ToolConfigError,
    ToolConfigurationError,
    ToolError,
    ToolResolver,
    ToolSecretProvider,
    ToolSpec,
    UnsupportedToolProviderError,
    WorkflowToolResolver,
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
    "AgentTemplate",
    "SessionConfig",
    "HarnessAgentTemplate",
    "PiAgentTemplate",
    "ClaudeAgentTemplate",
    "AgentaAgentTemplate",
    "OpencodeAgentTemplate",
    "HarnessType",
    "HarnessIdentity",
    "HARNESS_IDENTITIES",
    "HarnessCapabilities",
    "ContentBlock",
    "Message",
    "to_messages",
    "Event",
    "AgentResult",
    "AgentStream",
    # Former flat Vercel adapter names (compatibility; new code uses adapters.vercel)
    "from_ui_messages",
    "to_ui_message",
    "ui_message_stream",
    "TraceContext",
    "RunContext",
    "RunContextReference",
    "RunContextWorkflow",
    "RunContextTrace",
    "ToolCallback",
    "PermissionPolicy",
    "SandboxPermission",
    "NetworkEgress",
    # Canonical tools API
    "ToolConfig",
    "BuiltinToolConfig",
    "GatewayToolConfig",
    "CodeToolConfig",
    "ClientToolConfig",
    "ReferenceToolConfig",
    "PlatformToolConfig",
    "ToolSpec",
    "CallbackToolSpec",
    "CodeToolSpec",
    "ClientToolSpec",
    "ToolCall",
    "ResolvedToolSet",
    "GatewayToolResolution",
    "ToolResolver",
    "ToolSecretProvider",
    "GatewayToolResolver",
    "WorkflowToolResolver",
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
    "MCPDisabledError",
    "MissingMCPSecretError",
    # Skills are a sibling subsystem
    "SkillTemplate",
    "SkillFile",
    "parse_skill_template",
    "parse_skill_templates",
    "skill_to_wire",
    "skills_to_wire",
    "SkillError",
    "SkillValidationError",
    # Connections are a sibling subsystem (provider / model / auth)
    "ModelRef",
    "Connection",
    "Endpoint",
    "ResolvedConnection",
    "RuntimeAuthContext",
    "ConnectionResolver",
    "EnvConnectionResolver",
    "StaticConnectionResolver",
    "AgentConnectionError",
    "ConnectionResolutionError",
    "ConnectionNotFoundError",
    "MissingProviderError",
    "AmbiguousConnectionError",
    "ProviderMismatchError",
    "UnsupportedProviderError",
    "UnsupportedConnectionModeError",
    # Minimal per-harness connection-capability table (subset; harness-capabilities owns the full one)
    "HarnessConnectionCapabilities",
    "HARNESS_CONNECTION_CAPABILITIES",
    "harness_allows_provider",
    "harness_allows_mode",
    # Interfaces (ports)
    "Backend",
    "Sandbox",
    "Session",
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
    "OpencodeHarness",
    "make_harness",
]
