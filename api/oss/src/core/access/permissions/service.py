from typing import List, Optional, Union
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from oss.src.core.access.dtos import RequestCredentialKind, RoleRequirement
from oss.src.core.access.permissions.types import Permission, RequiredRole
from oss.src.core.access.context import get_request_access
from oss.src.core.access.types import RequestAccessMismatch, RequestAccessMissing
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
    """Check that the current request's principal may do an action in a project.

    The decision is `AccessService.check_request` for the request's principal
    (`RequestAccess`, set by the auth middleware). No cache stores the decision. There
    is no fallback to the human `user_uid`: code that checks another human, or runs
    without request access, calls `AccessService.check_human` explicitly.

    Args:
        user_uid (str): The request's acting user id. A different user is a programming
            error (`RequestAccessMismatch`).
        project_id (str): The ID of the project. Required.
        permission (Permission): The permission to check.
        role (str): The role to check.

    Returns:
        bool: True if the principal may do the action, else False.
    """

    if permission is None and role is None:
        raise Exception("Either permission or role must be provided")
    elif permission is not None and role is not None:
        raise Exception("Only one of permission or role must be provided")

    access_service = get_access_service()

    access = get_request_access()
    if access is None:
        raise RequestAccessMissing()
    if str(access.acting_user_id) != str(user_uid):
        raise RequestAccessMismatch()

    if project_id is None:
        # A caller that passes no project is a programming error, as before.
        raise Exception("Project_ID is required to check object-level permissions")

    try:
        target_project_id = UUID(str(project_id))
    except ValueError:
        # A malformed id names no project: deny.
        return False

    action = (
        RoleRequirement(role=role.value if hasattr(role, "value") else str(role))
        if role is not None
        else permission
    )

    decision = await access_service.check_request(
        access=access,
        action=action,
        project_id=target_project_id,
    )
    return decision.allowed


async def check_organization_write(
    user_uid: str,
    organization_id: str,
    permission: Permission,
) -> bool:
    """An organization-level write by an API key or a run credential must come from
    the organization's default project, as the workspace routes require: each checks
    `check_action_access` on the default project, and a credential of another project
    is refused there. The route still runs its own owner or admin check.

    A browser session is not confined to a project, so it passes here unchanged.
    """

    access = get_request_access()
    if access is None:
        raise RequestAccessMissing()
    if access.credential_kind == RequestCredentialKind.BEARER_SESSION:
        return True

    # The organization's default project, by the rule every reader uses (D-11).
    default = await db_manager.fetch_default_project(
        workspace_or_organization_id=str(organization_id)
    )
    if default is None:
        return False
    return await check_action_access(
        user_uid=user_uid,
        project_id=str(default.project_id),
        permission=permission,
    )
