"""Re-export shim. RBAC permission/role enums now live in OSS.

Kept so existing EE imports (`ee.src.core.access.permissions.types`) keep working.
"""

from oss.src.core.access.permissions.types import (  # noqa: F401
    DefaultRole,
    RequiredRole,
    Permission,
)
