from typing import List

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import APIRouter
from ee.src.utils.permissions import check_action_access
from ee.src.services import workspace_manager, db_manager_ee

from ee.src.models.api.workspace_models import (
    UserRole,
    WorkspaceRole,
)
from ee.src.models.shared_models import Permission

router = APIRouter()

log = get_module_logger(__name__)


@router.get(
    "/permissions/",
    operation_id="get_all_workspace_permissions",
    response_model=List[Permission],
)
async def get_all_workspace_permissions() -> List[Permission]:
    """
    Get all workspace permissions.

    Returns a list of all available workspace permissions.

    Returns:
        List[Permission]: A list of Permission objects representing the available workspace permissions.

    Raises:
        HTTPException: If there is an error retrieving the workspace permissions.

    """
    try:
        workspace_permissions = await workspace_manager.get_all_workspace_permissions()
        return sorted(workspace_permissions)
    except Exception:
        log.error(
            "Unexpected error while fetching workspace permissions",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while fetching workspace permissions.",
        )


@router.post("/{workspace_id}/roles/", operation_id="assign_role_to_user")
async def assign_role_to_user(
    payload: UserRole,
    workspace_id: str,
    request: Request,
):
    """
    Assigns a role to a user in a workspace.

    Args:
        payload (UserRole): The payload containing the organization id, user email, and role to assign.
        workspace_id (str): The ID of the workspace.
        request (Request): The FastAPI request object.

    Returns:
        bool: True if the role was successfully assigned, False otherwise.

    Raises:
        HTTPException: If the user does not have permission to perform this action.
        HTTPException: If there is an error assigning the role to the user.
    """

    try:
        project = await db_manager_ee.get_project_by_workspace(workspace_id)
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

        if not WorkspaceRole.is_valid_role(payload.role):  # type: ignore
            return JSONResponse(
                status_code=400, content={"detail": "Workspace role is invalid."}
            )

        create_user_role = await db_manager_ee.update_user_roles(
            workspace_id,
            payload,
        )
        return create_user_role
    except HTTPException as ex:
        raise ex
    except Exception:
        log.error(
            "Unexpected error while assigning role to user",
            exc_info=True,
        )
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
    Delete a role assignment from a user in a workspace.

    Args:
        workspace_id (str): The ID of the workspace.
        email (str): The email of the user to remove the role from.
        organization_id (str): The ID of the organization.
        role (str): The role to remove from the user.
        request (Request): The FastAPI request object.

    Returns:
        bool: True if the role assignment was successfully deleted.

    Raises:
        HTTPException: If there is an error in the request or the user does not have permission to perform the action.
        HTTPException: If there is an error in updating the user's roles.

    """
    try:
        project = await db_manager_ee.get_project_by_workspace(workspace_id)
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

        delete_user_role = await db_manager_ee.update_user_roles(
            workspace_id,
            payload,
            delete=True,
        )

        return delete_user_role
    except HTTPException as ex:
        raise ex
    except Exception:
        log.error(
            "Unexpected error while unassigning role from user",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while unassigning role from user.",
        )
