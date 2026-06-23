from typing import List, Dict

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager
from oss.src.utils.common import APIRouter, is_ee
from oss.src.models.api.workspace_models import Workspace, UserRole

from oss.src.core.access.permissions.service import (
    check_action_access,
    check_rbac_permission,
)
from oss.src.core.access.permissions.types import Permission, RequiredRole
from oss.src.core.access.controls import get_role, get_roles
from oss.src.services.db_manager import (
    get_user_org_and_workspace_id,
    get_project_by_workspace,
)

if is_ee():
    from ee.src.services import workspace_manager

    from ee.src.core.access.entitlements.service import (
        check_entitlements,
        scope_from,
        Gauge,
    )


router = APIRouter()

log = get_module_logger(__name__)


@router.get("/", operation_id="get_workspace", response_model=List[Workspace])
async def get_workspace(request: Request):
    """
    Get workspace details.

    Returns details about the workspace associated with the user's session.

    Returns:
        Workspace: The details of the workspace.

    Raises:
        HTTPException: If the user does not have permission to perform this action.
    """

    workspaces_db = await db_manager.get_user_workspaces(request.state.user_id)
    return [
        Workspace(
            id=str(workspace_db.id),
            name=str(workspace_db.name),
            description=str(workspace_db.description),
            type=workspace_db.type,  # type: ignore
        )
        for workspace_db in workspaces_db
    ]


@router.get(
    "/roles/",
    operation_id="get_all_workspace_roles",
)
async def get_all_workspace_roles(request: Request) -> List[Dict[str, str]]:
    """
    Get all workspace roles.

    Returns a list of all available workspace roles.

    Returns:
        List[WorkspaceRoleResponse]: A list of DefaultRole objects representing the available workspace roles.

    Raises:
        HTTPException: If an error occurs while retrieving the workspace roles.
    """

    # Resolve via access-controls (env-overridable via AGENTA_ACCESS_ROLES).
    workspace_roles_with_description = [
        {
            "role_name": role["role"],
            "role_description": role.get("description") or "",
        }
        for role in get_roles("workspace")
    ]

    return workspace_roles_with_description


@router.post("/{workspace_id}/roles/", operation_id="assign_role_to_user")
async def assign_role_to_user(
    payload: UserRole,
    workspace_id: str,
    request: Request,
):
    """
    Assign a role to a user in a workspace.

    Args:
        payload (UserRole): The organization id, user email, and role to assign.
        workspace_id (str): The ID of the workspace.
    """

    try:
        project = await get_project_by_workspace(workspace_id)
        if str(project.organization_id) != str(payload.organization_id):
            return JSONResponse(
                status_code=400,
                content={"detail": "Workspace does not belong to the organization."},
            )
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(project.id),
            permission=Permission.MODIFY_USER_ROLES,
        )
        if not has_permission:
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "You do not have permission to perform this action. Please contact your Organization Owner"
                },
            )

        if not payload.role or get_role("workspace", payload.role) is None:
            return JSONResponse(
                status_code=400, content={"detail": "Workspace role is invalid."}
            )

        return await db_manager.update_user_roles(workspace_id, payload)
    except HTTPException as ex:
        raise ex
    except Exception:
        log.error("Unexpected error while assigning role to user", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while assigning role to user.",
        )


@router.delete("/{workspace_id}/roles/", operation_id="unassign_role_from_user")
async def unassign_role_from_user(
    email: str,
    organization_id: str,
    role: str,
    workspace_id: str,
    request: Request,
):
    """
    Remove a role assignment from a user in a workspace.

    Args:
        email (str): The email of the user.
        organization_id (str): The ID of the organization.
        role (str): The role to remove.
        workspace_id (str): The ID of the workspace.
    """

    try:
        project = await get_project_by_workspace(workspace_id)
        if str(project.organization_id) != str(organization_id):
            return JSONResponse(
                status_code=400,
                content={"detail": "Workspace does not belong to the organization."},
            )
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(project.id),
            permission=Permission.MODIFY_USER_ROLES,
        )
        if not has_permission:
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "You do not have permission to perform this action. Please contact your Organization Owner"
                },
            )

        payload = UserRole(
            email=email,
            organization_id=organization_id,
            role=role,
        )

        return await db_manager.update_user_roles(workspace_id, payload, delete=True)
    except HTTPException as ex:
        raise ex
    except Exception:
        log.error("Unexpected error while unassigning role from user", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while unassigning role from user.",
        )


@router.delete("/{workspace_id}/users/", operation_id="remove_user_from_workspace")
async def remove_user_from_workspace(
    email: str,
    workspace_id: str,
    request: Request,
):
    """
    Remove a user from a workspace.

    Args:
        email (str): The email address of the user to be removed
        workspace_id (str): The ID of the workspace.
    """

    user_org_workspace_data = await get_user_org_and_workspace_id(request.state.user_id)
    project = await get_project_by_workspace(workspace_id)
    has_permission = await check_rbac_permission(
        user_org_workspace_data=user_org_workspace_data,
        project_id=str(project.id),
        role=RequiredRole.ADMIN,
    )
    if not has_permission:
        return JSONResponse(
            status_code=403,
            content={
                "detail": "You do not have permission to perform this action. Please contact your Organization Owner"
            },
        )

    if is_ee():
        # Load the owner of the *target* workspace's org (not the caller's
        # ambient org) so the agenta.ai skip-meter exemption and the meter
        # decrement below agree on which organization is being acted on.
        owner = await db_manager.get_organization_owner(str(project.organization_id))
        owner_domain = owner.email.split("@")[-1].lower() if owner else ""
        user_domain = email.split("@")[-1].lower()
        skip_meter = owner_domain != "agenta.ai" and user_domain == "agenta.ai"

        if not skip_meter:
            # Decrement the user gauge in the *target* workspace's owning
            # org (loaded via the path-param `{workspace_id}`), not the
            # caller's ambient org — cross-org admin actions otherwise
            # land the `-1` in the wrong meter.
            await check_entitlements(  # type: ignore
                key=Gauge.USERS,  # type: ignore
                delta=-1,
                scope=scope_from(organization_id=project.organization_id),  # type: ignore
            )

        try:
            delete_user_from_workspace = (
                await workspace_manager.remove_user_from_workspace(workspace_id, email)
            )
        except Exception:
            log.error(
                "Failed to remove user from EE workspace",
                workspace_id=workspace_id,
                project_id=str(project.id),
                organization_id=str(project.organization_id),
                email=email,
                exc_info=True,
            )
            raise

    else:
        delete_user_from_workspace = await db_manager.remove_user_from_workspace(
            workspace_id=workspace_id,
            email=email,
        )

    return delete_user_from_workspace
