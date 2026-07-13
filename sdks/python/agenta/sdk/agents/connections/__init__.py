"""Public provider / model / connection API for the agent runtime.

The neutral contracts (:class:`ModelRef`, :class:`Connection`, :class:`Endpoint`), the
resolved least-privilege output (:class:`ResolvedConnection`, :class:`RuntimeAuthContext`),
the resolver port (:class:`ConnectionResolver`), and the offline SDK-default adapters
(:class:`EnvConnectionResolver`, :class:`StaticConnectionResolver`).
"""

from .errors import (
    AgentConnectionError,
    AmbiguousConnectionError,
    ConnectionNotFoundError,
    ConnectionResolutionError,
    InvalidConnectionConfigurationError,
    MissingCredentialError,
    MissingProviderError,
    ProviderMismatchError,
    UnsupportedConnectionModeError,
    UnsupportedDeploymentError,
    UnsupportedProviderError,
)
from .interfaces import ConnectionResolver
from .models import (
    Connection,
    CredentialMode,
    CredentialUsage,
    Deployment,
    Endpoint,
    EnvironmentCredentialBinding,
    ModelRef,
    ResolvedConnection,
    ResolvedCredential,
    RuntimeAuthContext,
)
from .resolver import EnvConnectionResolver, StaticConnectionResolver

__all__ = [
    # Contracts
    "Connection",
    "Endpoint",
    "EnvironmentCredentialBinding",
    "ModelRef",
    "ResolvedConnection",
    "ResolvedCredential",
    "RuntimeAuthContext",
    "CredentialMode",
    "CredentialUsage",
    "Deployment",
    # Port + adapters
    "ConnectionResolver",
    "EnvConnectionResolver",
    "StaticConnectionResolver",
    # Errors
    "AgentConnectionError",
    "ConnectionResolutionError",
    "InvalidConnectionConfigurationError",
    "ConnectionNotFoundError",
    "MissingCredentialError",
    "MissingProviderError",
    "AmbiguousConnectionError",
    "ProviderMismatchError",
    "UnsupportedProviderError",
    "UnsupportedConnectionModeError",
    "UnsupportedDeploymentError",
]
