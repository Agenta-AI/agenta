from typing import Dict, List, Union, Optional, Sequence, Any

from fastapi import HTTPException

from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, set_cache

from oss.src.models.db_models import (
    OrganizationDB,
    WorkspaceDB,
    ProjectDB,
)
from ee.src.models.shared_models import (
    Permission,
    WorkspaceRole,
)

from oss.src.services import db_manager
from ee.src.services import db_manager_ee
from ee.src.utils.entitlements import check_entitlements, Flag
from ee.src.services.selectors import get_user_org_and_workspace_id


log = get_module_logger(__name__)

FORBIDDEN_EXCEPTION = HTTPException(
    status_code=403,
    detail="You do not have access to perform this action. Please contact your organization admin.",
)


def _get_project_member(
    user_id: str,
    members: Sequence[Any],
) -> Optional[Any]:
    """Return the project member record for a user, or None."""
    return next(
        (m for m in members if str(m.user_id) == user_id),
        None,
    )


def _get_project_member_role(
    user_id: str,
    members: Sequence[Any],
) -> Optional[str]:
    """Return the role of a user in a given project_members list, or None."""
    member = _get_project_member(user_id, members)
    return getattr(member, "role", None) if member else None


def _is_demo_member(
    user_id: str,
    members: Sequence[Any],
) -> bool:
    """Return True if the user is a demo member (is_demo=True) in the project."""
    member = _get_project_member(user_id, members)
    return getattr(member, "is_demo", False) if member else False


def _project_is_owner(
    user_id: str,
    members: Sequence[Any],
) -> bool:
    """True if the user is OWNER in the project."""
    role = _get_project_member_role(user_id, members)
    return role == WorkspaceRole.OWNER


def _project_has_role(
    user_id: str,
    role_to_check: WorkspaceRole,
    members: Sequence[Any],
) -> bool:
    """True if the user's role exactly matches role_to_check."""
    role = _get_project_member_role(user_id, members)
    return role == role_to_check if role is not None else False


def _project_has_permission(
    user_id: str,
    permission: Permission,
    members: Sequence[Any],
) -> bool:
    """True if the user's role implies the given permission."""
    role = _get_project_member_role(user_id, members)
    if role is None:
        return False
    # Permission.default_permissions was used in the old model methods
    return permission in Permission.default_permissions(role)


async def _get_workspace_member_ids(workspace: WorkspaceDB) -> List[str]:
    """
    Return all user IDs that are members of the given workspace.

    This assumes db_manager_ee.get_workspace_members(workspace_id=...) exists
    and returns workspace member rows with a .user_id attribute.
    """
    members = await db_manager_ee.get_workspace_members(workspace_id=str(workspace.id))
    return [str(m.user_id) for m in members]


async def check_user_org_access(
    kwargs: dict, organization_id: str, check_owner=False
) -> bool:
    if check_owner:  # Check that the user is the owner of the organization
        user = await db_manager.get_user_with_id(user_id=kwargs["id"])
        organization = await db_manager_ee.get_organization(organization_id)
        if not organization:
            log.error("Organization not found")
            raise Exception("Organization not found")
        return organization.owner_id == user.id  # type: ignore
    else:
        user_organizations: List = kwargs["organization_ids"]
        user_exists_in_organizations = organization_id in user_organizations
        return user_exists_in_organizations


async def check_user_access_to_workspace(
    user_org_workspace_data: Dict[str, Union[str, list]],
    workspace: WorkspaceDB,
    organization: OrganizationDB,
) -> bool:
    """
    Check if a user has access to a specific workspace and the workspace organization.

    Args:
        user_org_workspace_data (Dict[str, Union[str, list]]): User-specific information.
        workspace (WorkspaceDB): The workspace to check.
        organization (OrganizationDB): The organization to check.

    Returns:
        bool: True if the user has access, False otherwise.

    Raises:
        ValueError: If the workspace does not belong to the organization.
    """

    workspace_organization_id = str(workspace.organization_id)
    if (
        workspace is None
        or organization is None
        or workspace_organization_id != str(organization.id)
    ):
        raise ValueError("Workspace does not belong to the provided organization")

    # Check that the user belongs to the organization
    has_organization_access = await check_user_org_access(
        user_org_workspace_data, workspace_organization_id
    )
    if not has_organization_access:
        # log.debug("User does not belong and have access to the organization")
        return False

    # Check that the user belongs to the workspace
    user_id = user_org_workspace_data.get("id")
    if user_id is None:
        log.error("User ID is missing in user_org_workspace_data")
        return False

    workspace_members = await _get_workspace_member_ids(workspace)
    if user_id not in workspace_members:
        # log.debug("User does not belong to the workspace")
        return False

    # Check that the workspace is in the user's workspaces
    has_access_to_workspace = any(
        str(workspace.id) == workspace_id
        for workspace_id in user_org_workspace_data["workspace_ids"]
    )
    return has_access_to_workspace


async def check_action_access(
    user_uid: str,
    project_id: str = None,
    permission: Permission = None,
    role: str = None,
) -> bool:
    """
    Check if a user belongs to a workspace and has a certain permission.

    Args:
        user_id (str): The user's ID.
        object_id (str): The ID of the object to check.
        type (str): The type of the object to check.
        permission (Permission): The permission to check.
        role (str): The role to check.

    Returns:
        bool: True if the user belongs to the workspace and has the specified permission, False otherwise.
    """

    if permission is None and role is None:
        raise Exception("Either permission or role must be provided")
    elif permission is not None and role is not None:
        raise Exception("Only one of permission or role must be provided")

    cache_key = {
        "permission": permission.value if permission else None,
        "role": role,
    }

    has_permission = await get_cache(
        project_id=project_id,
        user_id=user_uid,
        namespace="check_action_access",
        key=cache_key,
    )

    if has_permission is not None:
        return has_permission

    user_org_workspace_data: dict = await get_user_org_and_workspace_id(user_uid)
    has_permission = await check_rbac_permission(
        user_org_workspace_data=user_org_workspace_data,
        project_id=project_id,
        role=role,
        permission=permission,
    )

    await set_cache(
        project_id=project_id,
        user_id=user_uid,
        namespace="check_action_access",
        key=cache_key,
        value=has_permission,
    )

    return has_permission


# async def check_apikey_action_access(
#     api_key: str, user_id: str, permission: Permission
# ):
#     """
#     Check if an api key belongs to a user for a workspace and has the right permission.

#     Args:
#         api_key (str): The api key
#         user_id (str): The user (owner) ID of the api_key
#         permission (Permission): The permission to check for.
#     """

#     api_key_prefix = api_key.split(".")[0]
#     api_key_db = await db_manager.get_user_api_key_by_prefix(
#         api_key_prefix=api_key_prefix, user_id=user_id
#     )
#     if api_key_db is None:
#         raise HTTPException(
#             404, {"message": f"API Key with prefix {api_key_prefix} not found"}
#         )

#     project_db = await db_manager.get_project_by_id(
#         project_id=str(api_key_db.project_id)
#     )
#     if project_db is None:
#         raise HTTPException(
#             404,
#             {"message": f"Project with ID {str(api_key_db.workspace_id)} not found"},
#         )

#     has_access = await check_project_has_role_or_permission(
#         project_db, str(api_key_db.created_by_id), None, permission
#     )
#     if not has_access:
#         raise HTTPException(
#             403,
#             {
#                 "message": "You do not have access to perform this action. Please contact your organization admin."
#             },
#         )


async def check_rbac_permission(
    user_org_workspace_data: Dict[str, Union[str, list]],
    project_id: str = None,
    permission: Permission = None,
    role: str = None,
) -> bool:
    """
    Check if a user belongs to a workspace and has a certain permission.

    Args:
        user_org_workspace_data (Dict[str, Union[str, list]]): User-specific information containing the id, uid, list of user organization and list of user workspace.
        project_id (str): The ID of the project.
        permission (Permission): The permission to check for.
        role (str): The role to check for.

    Returns:
        bool: True if the user belongs to the workspace and has the specified permission, False otherwise.
    """

    assert project_id is not None, (
        "Project_ID is required to check object-level permissions"
    )

    # Assert that either permission or role is provided, but not both
    assert (permission is not None) or (role is not None), (
        "Either 'permission' or 'role' must be provided, but neither is provided"
    )
    assert not ((permission is not None) and (role is not None)), (
        "'permission' and 'role' cannot both be provided at the same time"
    )

    if project_id is not None:
        project = await db_manager.get_project_by_id(project_id)
        if project is None:
            log.error(f"Project {project_id} not found during permission check")
            return False

        workspace = await db_manager.get_workspace(str(project.workspace_id))
        organization = await db_manager_ee.get_organization(
            str(project.organization_id)
        )

    workspace_has_access = await check_user_access_to_workspace(
        user_org_workspace_data=user_org_workspace_data,
        workspace=workspace,
        organization=organization,
    )
    if not workspace_has_access:
        # log.debug("User does not have access to the workspace")
        return False

    user_id = user_org_workspace_data["id"]
    assert isinstance(user_id, str), "User ID must be a string"
    has_access = await check_project_has_role_or_permission(
        project, user_id, role, permission
    )
    return has_access


async def check_project_has_role_or_permission(
    # organization_id: str,
    project: ProjectDB,
    user_id: str,
    role: Optional[str] = None,
    permission: Optional[str] = None,
):
    """Check if a user has the provided role or permission in a project.

    Args:
        project (ProjectDB): The project to check if the user has permissions to
        user_id (str): The ID of the user
        role (Optional[str], optional): The role to check for. Defaults to None.
        permission (Optional[str], optional): The permission to check for. Defaults to None.
    """

    assert role is not None or permission is not None, (
        "Either role or permission must be provided"
    )

    # Fetch project members first - needed for both demo check and permission check
    project_members = await db_manager_ee.get_project_members(
        project_id=str(project.id)
    )

    # Check if user is a demo member - demo members always have restricted access
    # regardless of the organization's RBAC setting
    is_demo = _is_demo_member(user_id, project_members)

    if not is_demo:
        # For non-demo members, check if RBAC is enabled
        # If RBAC is disabled, grant full access (current behavior for paid plans)
        check, _, _ = await check_entitlements(
            organization_id=project.organization_id,
            key=Flag.RBAC,
        )

        if not check:
            return True

    # Check if user is organization owner - organization owners always have full permissions
    organization = await db_manager_ee.get_organization(str(project.organization_id))
    if organization and str(organization.owner_id) == str(user_id):
        return True

    # OWNER role in workspace members also passes (but demo members can't be owners by design)
    if _project_is_owner(user_id, project_members):
        return True

    if role is not None:
        if role not in list(WorkspaceRole):
            raise Exception("Invalid role specified")
        return _project_has_role(user_id, role, project_members)

    if permission is not None:
        if permission not in list(Permission):
            raise Exception("Invalid permission specified")
        return _project_has_permission(user_id, permission, project_members)

    return False
