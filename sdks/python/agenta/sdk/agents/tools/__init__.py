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
from .parsing import parse_tool_config
from .resolver import EnvironmentToolSecretProvider, ToolResolver

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
    "coerce_tool_config",
    "coerce_tool_configs",
    "ToolConfigDiagnostic",
    "ToolConfigParseResult",
    "ToolError",
    "ToolConfigError",
    "ToolConfigurationError",
    "ToolResolutionError",
    "GatewayToolResolutionError",
    "UnsupportedToolProviderError",
    "MissingToolSecretError",
    "DuplicateToolNameError",
]
