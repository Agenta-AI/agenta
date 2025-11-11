from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager
from ee.src.services import db_manager_ee
from oss.src.utils.common import APIRouter
from ee.src.services import workspace_manager
from ee.src.models.db_models import Permission
from ee.src.services.selectors import (
    get_user_own_org,
    get_user_org_and_workspace_id,
)
from ee.src.models.api.workspace_models import (
    CreateWorkspace,
    UpdateWorkspace,
    WorkspaceResponse,
)
from ee.src.utils.permissions import (
    check_user_org_access,
    check_rbac_permission,
)
from ee.src.models.api.organization_models import (
    CreateOrganization,
    OrganizationUpdate,
    OrganizationOutput,
)
from ee.src.services.organization_service import (
    update_an_organization,
    get_organization_details,
)


router = APIRouter()

log = get_module_logger(__name__)



@router.get("/own/", response_model=OrganizationOutput, operation_id="get_own_org")
async def get_user_organization(
    request: Request,
):
    try:
        user_org_workspace_data: dict = await get_user_org_and_workspace_id(
            request.state.user_id
        )
        org_db = await get_user_own_org(user_uid=user_org_workspace_data["uid"])
        if org_db is None:
            raise HTTPException(404, detail="User does not have an organization")

        return OrganizationOutput(id=str(org_db.id), name=org_db.name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{org_id}/", operation_id="fetch_ee_organization_details")
async def fetch_organization_details(
    org_id: str,
    request: Request,
):
    """Get an organization's details.

    Raises:
        HTTPException: _description_
        Permission Denied

    Returns:
        OrganizationDB Instance
    """

    try:
        workspace_id = await db_manager_ee.get_default_workspace_id_from_organization(
            organization_id=org_id
        )

        project_id = await db_manager.get_default_project_id_from_workspace(
            workspace_id=workspace_id
        )

        project_memberships = await db_manager_ee.fetch_project_memberships_by_user_id(
            user_id=str(request.state.user_id)
        )

        membership = None
        for project_membership in project_memberships:
            if str(project_membership.project_id) == project_id:
                membership = project_membership
                break

        if not membership:
            return JSONResponse(
                status_code=403,
                content={"detail": "You do not have access to this organization"},
            )

        user_org_workspace_data = await get_user_org_and_workspace_id(
            request.state.user_id
        )
        has_permission = await check_user_org_access(user_org_workspace_data, org_id)
        if not has_permission:
            return JSONResponse(
                status_code=403,
                content={"detail": "You do not have access to this organization"},
            )

        organization = await get_organization_details(org_id)

        if membership.role == "viewer" or membership.is_demo:
            if "default_workspace" in organization:
                organization["default_workspace"].members = []

        return organization

    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )


@router.put("/{org_id}/", operation_id="update_organization")
async def update_organization(
    org_id: str,
    payload: OrganizationUpdate,
    request: Request,
):
    if not payload.name and not payload.description:
        return JSONResponse(
            {"detail": "Please provide a name or description to update"},
            status_code=400,
        )

    try:
        user_org_workspace_data: dict = await get_user_org_and_workspace_id(
            request.state.user_id
        )
        has_permission = await check_user_org_access(
            user_org_workspace_data, org_id, check_owner=True
        )
        if not has_permission:
            return JSONResponse(
                {"detail": "You do not have permission to perform this action"},
                status_code=403,
            )

        organization = await update_an_organization(org_id, payload)

        return organization

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )


@router.post(
    "/{org_id}/workspaces/",
    operation_id="create_workspace",
    response_model=WorkspaceResponse,
)
async def create_workspace(
    org_id: str,
    payload: CreateWorkspace,
    request: Request,
) -> WorkspaceResponse:
    try:
        user_org_workspace_data: dict = await get_user_org_and_workspace_id(
            request.state.user_id
        )
        has_permission = await check_user_org_access(
            user_org_workspace_data, org_id, check_owner=True
        )
        if not has_permission:
            return JSONResponse(
                {"detail": "You do not have permission to perform this action"},
                status_code=403,
            )

        if not payload.name:
            return JSONResponse(
                {"detail": "Please provide a name to create a workspace"},
                status_code=400,
            )
        workspace = await workspace_manager.create_new_workspace(
            payload, org_id, user_org_workspace_data["uid"]
        )
        return workspace

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )


@router.put(
    "/{org_id}/workspaces/{workspace_id}/",
    operation_id="update_workspace",
    response_model=WorkspaceResponse,
)
async def update_workspace(
    org_id: str,
    workspace_id: str,
    payload: UpdateWorkspace,
    request: Request,
) -> WorkspaceResponse:
    try:
        user_org_workspace_data: dict = await get_user_org_and_workspace_id(
            request.state.user_id
        )
        project = await db_manager_ee.get_project_by_workspace(workspace_id)
        has_permission = await check_rbac_permission(
            user_org_workspace_data=user_org_workspace_data,
            project_id=str(project.id),
            permission=Permission.EDIT_WORKSPACE,
        )
        if not has_permission:
            return JSONResponse(
                {"detail": "You do not have permission to update this workspace"},
                status_code=403,
            )

        if not payload.name and not payload.description:
            return JSONResponse(
                {"detail": "Please provide a name or description to update"},
                status_code=400,
            )
        workspace = await workspace_manager.update_workspace(payload, workspace_id)
        return workspace

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )
