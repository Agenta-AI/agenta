"""Re-export shim. RBAC enforcement now lives in OSS and runs in both editions.

The EE-specific behavior (the `Flag.RBAC` entitlement bypass) is layered back
inside the OSS service via an `is_ee()`-guarded, function-local import — see
`oss.src.core.access.permissions.service.check_project_has_role_or_permission`.

Kept so existing EE imports (`ee.src.core.access.permissions.service`) keep working.
"""

from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION  # noqa: F401
from oss.src.core.access.permissions.service import (  # noqa: F401
    check_action_access,
    check_rbac_permission,
    check_user_org_access,
    check_user_access_to_workspace,
    check_project_has_role_or_permission,
)
