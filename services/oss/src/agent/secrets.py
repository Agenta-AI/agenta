"""Harness provider-key resolution: now lives in the SDK platform package.

Kept as a thin re-export so existing service imports keep working. ``resolve_harness_secrets``
is the prior name for the SDK's ``resolve_provider_keys``.

The agent ``/invoke`` path no longer calls this: it resolves ONE least-privilege connection
for the configured model via ``resolve_connection`` (``oss.src.agent.app``) instead of the
model-blind whole-vault dump. This module remains only for the deprecated direct-import
integration test (``test_resolve_secrets_http.py``) until that function is removed.
"""

from agenta.sdk.agents.platform.secrets import (
    _PROVIDER_ENV_VARS,
    resolve_provider_keys as resolve_harness_secrets,
)

__all__ = ["resolve_harness_secrets", "_PROVIDER_ENV_VARS"]
