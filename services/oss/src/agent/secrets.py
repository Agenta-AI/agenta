"""Harness provider-key resolution: now lives in the SDK platform package.

Kept as a thin re-export so existing service imports keep working. ``resolve_harness_secrets``
is the prior name for the SDK's ``resolve_provider_keys``.
"""

from agenta.sdk.agents.platform.secrets import (
    _PROVIDER_ENV_VARS,
    resolve_provider_keys as resolve_harness_secrets,
)

__all__ = ["resolve_harness_secrets", "_PROVIDER_ENV_VARS"]
