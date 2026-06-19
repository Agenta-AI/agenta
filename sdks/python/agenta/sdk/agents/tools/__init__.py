"""Public agent-tool configuration and resolution API."""

from .compat import (
    ToolConfigDiagnostic,
    ToolConfigParseResult,
    coerce_tool_config,
    coerce_tool_configs,
)
from .errors import (
    DuplicateToolNameError,
    GatewayToolResolutionError,
    MissingToolSecretError,
    ToolConfigError,
    ToolConfigurationError,
    ToolError,
    ToolResolutionError,
    UnsupportedToolProviderError,
)
from .interfaces import GatewayToolResolver, ToolSecretProvider
from .models import (
    BuiltinToolConfig,
    CallbackToolSpec,
    ClientToolConfig,
    ClientToolSpec,
    CodeToolConfig,
    CodeToolSpec,
    GatewayToolConfig,
    GatewayToolResolution,
    MissingSecretPolicy,
    ResolvedToolSet,
    ToolCallback,
    ToolConfig,
    ToolConfigBase,
    ToolSpec,
)
from .parsing import parse_tool_config, parse_tool_configs
from .resolver import EnvironmentToolSecretProvider, ToolResolver
from .wire import tool_spec_to_wire, tool_specs_to_wire

__all__ = [
    "ToolConfigBase",
    "ToolConfig",
    "BuiltinToolConfig",
    "GatewayToolConfig",
    "CodeToolConfig",
    "ClientToolConfig",
    "ToolSpec",
    "CallbackToolSpec",
    "CodeToolSpec",
    "ClientToolSpec",
    "ToolCallback",
    "ResolvedToolSet",
    "GatewayToolResolution",
    "MissingSecretPolicy",
    "ToolResolver",
    "ToolSecretProvider",
    "GatewayToolResolver",
    "EnvironmentToolSecretProvider",
    "parse_tool_config",
    "parse_tool_configs",
    "coerce_tool_config",
    "coerce_tool_configs",
    "ToolConfigDiagnostic",
    "ToolConfigParseResult",
    "tool_spec_to_wire",
    "tool_specs_to_wire",
    "ToolError",
    "ToolConfigError",
    "ToolConfigurationError",
    "ToolResolutionError",
    "GatewayToolResolutionError",
    "UnsupportedToolProviderError",
    "MissingToolSecretError",
    "DuplicateToolNameError",
]
