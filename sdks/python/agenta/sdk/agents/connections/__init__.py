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
    ProviderMismatchError,
    UnsupportedConnectionModeError,
    UnsupportedDeploymentError,
    UnsupportedProviderError,
)
from .interfaces import ConnectionResolver
from .models import (
    Connection,
    CredentialMode,
    Deployment,
    Endpoint,
    ModelRef,
    ResolvedConnection,
    RuntimeAuthContext,
)
from .resolver import EnvConnectionResolver, StaticConnectionResolver

__all__ = [
    # Contracts
    "Connection",
    "Endpoint",
    "ModelRef",
    "ResolvedConnection",
    "RuntimeAuthContext",
    "CredentialMode",
    "Deployment",
    # Port + adapters
    "ConnectionResolver",
    "EnvConnectionResolver",
    "StaticConnectionResolver",
    # Errors
    "AgentConnectionError",
    "ConnectionResolutionError",
    "ConnectionNotFoundError",
    "AmbiguousConnectionError",
    "ProviderMismatchError",
    "UnsupportedProviderError",
    "UnsupportedConnectionModeError",
    "UnsupportedDeploymentError",
]
