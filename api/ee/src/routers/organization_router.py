from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager
from ee.src.services import db_manager_ee
from oss.src.utils.common import APIRouter
from ee.src.services import workspace_manager
from ee.src.models.shared_models import Permission
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
    OrganizationUpdate,
    OrganizationOutput,
    CreateCollaborativeOrganization,
)
from ee.src.services.organization_service import (
    update_an_organization,
    get_organization_details,
    transfer_organization_ownership as transfer_ownership_service,
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


@router.get("/{organization_id}/", operation_id="fetch_ee_organization_details")
async def fetch_organization_details(
    organization_id: str,
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
        # Get workspace and project IDs for permission checking
        workspace_id = None
        project_id = None
        try:
            workspace_id = (
                await db_manager_ee.get_default_workspace_id_from_organization(
                    organization_id=organization_id
                )
            )
            project_id = await db_manager.get_default_project_id_from_workspace(
                workspace_id=workspace_id
            )
        except Exception:
            # Organization has no workspace or project - check org-level permission directly
            log.warning(
                f"Organization {organization_id} has no workspace or project, checking org-level access",
                exc_info=True,
            )

        # If we have a project, check project membership
        if project_id:
            project_memberships = (
                await db_manager_ee.fetch_project_memberships_by_user_id(
                    user_id=str(request.state.user_id)
                )
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

        # Check org-level access
        user_org_workspace_data = await get_user_org_and_workspace_id(
            request.state.user_id
        )
        has_permission = await check_user_org_access(
            user_org_workspace_data, organization_id
        )
        if not has_permission:
            return JSONResponse(
                status_code=403,
                content={"detail": "You do not have access to this organization"},
            )

        organization = await get_organization_details(organization_id)

        return organization

    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )


@router.put("/{organization_id}/", operation_id="update_organization")
@router.patch("/{organization_id}/", operation_id="patch_organization")
async def update_organization(
    organization_id: str,
    payload: OrganizationUpdate,
    request: Request,
):
    if not payload.slug and not payload.name and not payload.description:
        return JSONResponse(
            {"detail": "Please provide a field to update"},
            status_code=400,
        )

    try:
        user_org_workspace_data: dict = await get_user_org_and_workspace_id(
            request.state.user_id
        )
        has_permission = await check_user_org_access(
            user_org_workspace_data, organization_id, check_owner=True
        )
        if not has_permission:
            return JSONResponse(
                {"detail": "You do not have permission to perform this action"},
                status_code=403,
            )

        organization = await update_an_organization(organization_id, payload)

        return organization

    except ValueError as e:
        # Slug validation errors (format, immutability, personal org, etc.)
        return JSONResponse(
            {"detail": str(e)},
            status_code=400,
        )
    except Exception as e:
        # Check for unique constraint violation (duplicate slug)
        from sqlalchemy.exc import IntegrityError
        if isinstance(e, IntegrityError) and "uq_organizations_slug" in str(e):
            return JSONResponse(
                {"detail": "Organization slug already exists. Slugs must be unique."},
                status_code=409,
            )
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )


@router.post(
    "/{organization_id}/workspaces/",
    operation_id="create_workspace",
    response_model=WorkspaceResponse,
)
async def create_workspace(
    organization_id: str,
    payload: CreateWorkspace,
    request: Request,
) -> WorkspaceResponse:
    try:
        user_org_workspace_data: dict = await get_user_org_and_workspace_id(
            request.state.user_id
        )
        has_permission = await check_user_org_access(
            user_org_workspace_data, organization_id, check_owner=True
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
            payload, organization_id, user_org_workspace_data["uid"]
        )
        return workspace

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )


@router.put(
    "/{organization_id}/workspaces/{workspace_id}/",
    operation_id="update_workspace",
    response_model=WorkspaceResponse,
)
async def update_workspace(
    organization_id: str,
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


@router.post(
    "/{organization_id}/transfer/{new_owner_id}",
    operation_id="transfer_organization_ownership",
)
async def transfer_organization_ownership(
    organization_id: str,
    new_owner_id: str,
    request: Request,
):
    """Transfer organization ownership to another member."""
    try:
        user_id = request.state.user_id

        # Check if current user is the owner of the organization
        user_org_workspace_data: dict = await get_user_org_and_workspace_id(user_id)
        has_permission = await check_user_org_access(
            user_org_workspace_data, organization_id, check_owner=True
        )
        if not has_permission:
            return JSONResponse(
                {"detail": "Only the organization owner can transfer ownership"},
                status_code=403,
            )

        # Transfer ownership via service layer
        organization = await transfer_ownership_service(
            organization_id=organization_id,
            new_owner_id=new_owner_id,
            current_user_id=str(user_id),
        )

        return JSONResponse(
            {
                "organization_id": str(organization.id),
                "owner_id": str(organization.owner_id),
            },
            status_code=200,
        )

    except ValueError as e:
        # New owner not a member or organization not found
        return JSONResponse(
            {"detail": str(e)},
            status_code=400,
        )
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )


@router.post("/", operation_id="create_collaborative_organization")
async def create_collaborative_organization(
    payload: CreateCollaborativeOrganization,
    request: Request,
):
    """Create a new collaborative organization."""
    try:
        from uuid import UUID
        from ee.src.services.commoners import create_organization_with_subscription

        user = await db_manager.get_user(request.state.user_id)
        if not user:
            return JSONResponse(
                {"detail": "User not found"},
                status_code=404,
            )

        organization = await create_organization_with_subscription(
            user_id=UUID(str(user.id)),
            organization_email=user.email,
            organization_name=payload.name,
            organization_description=payload.description,
            is_personal=False,  # Collaborative organization
            use_reverse_trial=False,  # Use hobby plan instead
        )

        log.info(
            "[organization] collaborative organization created",
            organization_id=organization.id,
            user_id=user.id,
        )

        return JSONResponse(
            {
                "id": str(organization.id),
                "name": organization.name,
                "description": organization.description,
            },
            status_code=201,
        )

    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )


@router.delete("/{organization_id}/", operation_id="delete_organization")
async def delete_organization(
    organization_id: str,
    request: Request,
):
    """Delete an organization (owner only)."""
    try:
        user_org_workspace_data: dict = await get_user_org_and_workspace_id(
            request.state.user_id
        )
        has_permission = await check_user_org_access(
            user_org_workspace_data, organization_id, check_owner=True
        )
        if not has_permission:
            return JSONResponse(
                {"detail": "You do not have permission to perform this action"},
                status_code=403,
            )

        await db_manager_ee.delete_organization(organization_id)

        log.info(
            "[organization] organization deleted",
            organization_id=organization_id,
            user_id=request.state.user_id,
        )

        return JSONResponse(
            {"detail": "Organization deleted successfully"},
            status_code=200,
        )

    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )
