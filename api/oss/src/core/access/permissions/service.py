from typing import List, Optional, Union
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, set_cache

from oss.src.core.access.dtos import RoleRequirement
from oss.src.core.access.permissions.types import Permission, RequiredRole
from oss.src.core.access.controls import get_controls_hash
from oss.src.core.access.service import get_access_service

from oss.src.services import db_manager


log = get_module_logger(__name__)


async def check_user_org_access(
    kwargs: dict, organization_id: str, check_owner=False
) -> bool:
    if check_owner:  # Check that the user is the owner of the organization
        user = await db_manager.get_user_with_id(user_id=kwargs["id"])
        organization = await db_manager.get_organization(organization_id)
        if not organization:
            log.error("Organization not found")
            raise Exception("Organization not found")
        return organization.owner_id == user.id  # type: ignore
    else:
        user_organizations: List = kwargs["organization_ids"]
        user_exists_in_organizations = organization_id in user_organizations
        return user_exists_in_organizations


async def check_action_access(
    user_uid: str,
    project_id: Optional[str] = None,
    permission: Optional[Permission] = None,
    role: Optional[Union[RequiredRole, str]] = None,
) -> bool:
    """Check that a user is a member of a project and has a role or a permission there.

    Membership comes from `MembershipsService.resolve` (one statement); the decision
    from `AccessService.check_human`. The boolean is cached per (user, project)
    as before; every membership writer clears it.

    Args:
        user_uid (str): The user's ID.
        project_id (str): The ID of the project.
        permission (Permission): The permission to check.
        role (str): The role to check.

    Returns:
        bool: True if the user is a member with the permission or role, else False.
    """

    if permission is None and role is None:
        raise Exception("Either permission or role must be provided")
    elif permission is not None and role is not None:
        raise Exception("Only one of permission or role must be provided")

    # Read the registry before the cache, so a process that never registered the
    # service fails on its first check, also on a cache hit.
    access_service = get_access_service()

    cache_key = {
        "permission": permission.value if permission else None,
        "role": role,
        "controls": get_controls_hash(),
    }

    has_permission = await get_cache(
        project_id=project_id,
        user_id=user_uid,
        namespace="check_action_access",
        key=cache_key,
    )

    if has_permission is not None:
        return has_permission

    if project_id is None:
        # A caller that passes no project is a programming error, as before.
        raise Exception("Project_ID is required to check object-level permissions")

    try:
        user_id = UUID(str(user_uid))
        target_project_id = UUID(str(project_id))
    except ValueError:
        # A malformed id names no member and no project: deny, and do not cache.
        return False

    action = (
        RoleRequirement(role=role.value if hasattr(role, "value") else str(role))
        if role is not None
        else permission
    )

    decision = await access_service.check_human(
        user_id=user_id,
        project_id=target_project_id,
        action=action,
    )

    await set_cache(
        project_id=project_id,
        user_id=user_uid,
        namespace="check_action_access",
        key=cache_key,
        value=decision.allowed,
    )

    return decision.allowed
