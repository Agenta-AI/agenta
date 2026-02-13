from typing import List, Dict

from fastapi import Request
from fastapi.responses import JSONResponse

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager
from oss.src.utils.common import APIRouter, is_ee
from oss.src.models.api.workspace_models import Workspace

if is_ee():
    from ee.src.utils.permissions import check_rbac_permission
    from ee.src.models.api.workspace_models import WorkspaceRole
    from ee.src.services.selectors import get_user_org_and_workspace_id
    from ee.src.services import db_manager_ee, workspace_manager

    from ee.src.utils.entitlements import (
        check_entitlements,
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

    workspaces_db = await db_manager.get_workspaces()
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
        List[WorkspaceRoleResponse]: A list of WorkspaceRole objects representing the available workspace roles.

    Raises:
        HTTPException: If an error occurs while retrieving the workspace roles.
    """

    if is_ee():
        workspace_roles_with_description = []
        workspace_roles = await workspace_manager.get_all_workspace_roles()
        for role in workspace_roles:
            workspace_roles_with_description.append(
                {
                    "role_name": role,
                    "role_description": WorkspaceRole.get_description(role),
                }
            )

    else:
        workspace_roles_with_description = [
            {
                "role_name": "owner",
                "role_description": "Can fully manage the workspace, including adding and removing members.",
            },
            {
                "role_name": "editor",
                "role_description": "Can edit workspace content, but cannot manage members or roles.",
            },
        ]

    return workspace_roles_with_description


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

    if is_ee():
        user_org_workspace_data = await get_user_org_and_workspace_id(
            request.state.user_id
        )
        project = await db_manager_ee.get_project_by_workspace(workspace_id)
        has_permission = await check_rbac_permission(
            user_org_workspace_data=user_org_workspace_data,
            project_id=str(project.id),
            role=WorkspaceRole.WORKSPACE_ADMIN,
        )
        if not has_permission:
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "You do not have permission to perform this action. Please contact your Organization Owner"
                },
            )

        owner = await db_manager.get_organization_owner(request.state.organization_id)
        owner_domain = owner.email.split("@")[-1].lower() if owner else ""
        user_domain = email.split("@")[-1].lower()
        skip_meter = owner_domain != "agenta.ai" and user_domain == "agenta.ai"

        if not skip_meter:
            await check_entitlements(
                organization_id=request.state.organization_id,
                key=Gauge.USERS,
                delta=-1,
            )

        delete_user_from_workspace = await workspace_manager.remove_user_from_workspace(
            workspace_id, email
        )

    else:
        delete_user_from_workspace = await db_manager.remove_user_from_workspace(
            project_id=request.state.project_id,
            email=email,
        )

    return delete_user_from_workspace
