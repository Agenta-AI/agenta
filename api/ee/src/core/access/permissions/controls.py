"""Re-export shim. Role/permission controls now live in OSS.

Kept so existing EE imports (`ee.src.core.access.permissions.controls`) keep
working. `SCOPES` / `OWNER_PERMISSIONS` are re-exported too; EE entitlements keep
their own identical copies in `entitlements.types`.
"""

from oss.src.core.access.permissions.controls import (  # noqa: F401
    build_role_controls,
    OWNER_PERMISSIONS,
    SCOPES,
)
