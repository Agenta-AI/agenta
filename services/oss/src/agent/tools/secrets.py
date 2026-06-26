"""Named-secret provider: now lives in the SDK platform package.

Kept as a thin re-export so existing service imports keep working. ``VaultToolSecretProvider``
is the prior name for the SDK's ``AgentaNamedSecretProvider``.
"""

from agenta.sdk.agents.platform.secrets import (
    AgentaNamedSecretProvider as VaultToolSecretProvider,
    resolve_named_secrets,
)

__all__ = ["VaultToolSecretProvider", "resolve_named_secrets"]
