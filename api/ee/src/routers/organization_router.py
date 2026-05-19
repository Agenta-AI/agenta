from uuid import UUID

from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request

from oss.src.utils.common import APIRouter
from oss.src.utils.logging import get_module_logger

from oss.src.services import db_manager

from ee.src.utils.permissions import (
    check_user_org_access,
    check_rbac_permission,
)
from ee.src.utils.entitlements import (
    check_entitlements,
    Tracker,
    Flag,
    NOT_ENTITLED_RESPONSE,
)

from ee.src.services import (
    db_manager_ee,
    workspace_manager,
)
from ee.src.services.selectors import get_user_org_and_workspace_id
from ee.src.models.shared_models import Permission

from ee.src.models.api.workspace_models import (
    CreateWorkspace,
    UpdateWorkspace,
    WorkspaceResponse,
)

from ee.src.models.api.organization_models import (
    Organization,
    OrganizationUpdate,
    CreateOrganizationPayload,
)
from ee.src.services.organization_service import (
    update_an_organization,
    get_organization_details,
    transfer_organization_ownership as transfer_ownership_service,
)
from ee.src.services.commoners import create_organization_for_user
from ee.src.core.organizations.types import (
    OrganizationUpdate as OrganizationUpdateDTO,
)
from ee.src.core.organizations.exceptions import (
    OrganizationSlugConflictError,
    OrganizationCreationNotAllowedError,
)


router = APIRouter()

log = get_module_logger(__name__)


@router.get(
    "/{organization_id}",
    operation_id="fetch_ee_organization_details",
)
async def fetch_organization_details(
    request: Request,
    organization_id: str,
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

    except Exception:
        log.error(
            "Unexpected error while fetching organization details",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Unexpected error occurred while fetching organization details.",
        )


@router.put(
    "/{organization_id}",
    operation_id="update_organization",
    response_model=Organization,
)
@router.patch(
    "/{organization_id}",
    operation_id="patch_organization",
    response_model=Organization,
)
async def update_organization(
    request: Request,
    organization_id: str,
    payload: OrganizationUpdate,
):
    if (
        not payload.slug
        and not payload.name
        and not payload.description
        and not payload.flags
    ):
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

        if payload.flags is not None:
            check, _, _ = await check_entitlements(
                organization_id=organization_id,
                key=Flag.ACCESS,
            )
            if not check:
                return NOT_ENTITLED_RESPONSE(Tracker.FLAGS)

        organization = await update_an_organization(
            organization_id,
            OrganizationUpdateDTO(**payload.model_dump(exclude_unset=True)),
        )

        return organization

    except ValueError:
        # Slug validation errors (format, immutability, personal org, etc.)
        # Return a generic error message to avoid exposing internal details.
        return JSONResponse(
            {"detail": "Invalid request data for organization update."},
            status_code=400,
        )
    except OrganizationSlugConflictError:
        return JSONResponse(
            {
                "detail": "Slug already in use. Please select another slug or contact your administrator."
            },
            status_code=409,
        )
    except Exception:
        log.error(
            "Unexpected error while updating organization",
            exc_info=True,
        )

        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while updating the organization.",
        )


@router.post(
    "/{organization_id}/workspaces/",
    operation_id="create_workspace",
    response_model=WorkspaceResponse,
)
async def create_workspace(
    request: Request,
    organization_id: str,
    payload: CreateWorkspace,
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

    except Exception:
        log.error(
            "Unexpected error while creating workspace",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while creating the workspace.",
        )


@router.put(
    "/{organization_id}/workspaces/{workspace_id}",
    operation_id="update_workspace",
    response_model=WorkspaceResponse,
)
async def update_workspace(
    request: Request,
    organization_id: str,
    workspace_id: str,
    payload: UpdateWorkspace,
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

    except Exception:
        log.error(
            "Unexpected error while updating workspace",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while updating the workspace.",
        )


@router.post(
    "/{organization_id}/transfer/{new_owner_id}",
    operation_id="transfer_organization_ownership",
)
async def transfer_organization_ownership(
    request: Request,
    organization_id: str,
    new_owner_id: str,
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

    except ValueError:
        # New owner not a member or organization not found
        log.warning(
            "Invalid organization ownership transfer request",
            exc_info=True,
        )
        return JSONResponse(
            {"detail": "Invalid organization or new owner for ownership transfer"},
        )
    except Exception:
        log.error(
            "Unexpected error while transferring organization ownership",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while transferring organization ownership.",
        )


@router.post(
    "/",
    operation_id="create_organization",
)
async def create_organization(
    request: Request,
    payload: CreateOrganizationPayload,
):
    """Create a new organization."""
    try:
        user = await db_manager.get_user(request.state.user_id)
        if not user:
            return JSONResponse(
                {"detail": "User not found"},
                status_code=404,
            )

        organization = await create_organization_for_user(
            user_id=UUID(str(user.id)),
            organization_name=payload.name,
            organization_description=payload.description,
        )

        return JSONResponse(
            {
                "id": str(organization.id),
                "name": organization.name,
                "description": organization.description,
            },
            status_code=201,
        )

    except OrganizationCreationNotAllowedError as e:
        raise HTTPException(
            status_code=403,
            detail=e.message,
        ) from e

    except Exception:
        log.error(
            "Unexpected error while creating organization",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while creating the organization.",
        )


@router.delete(
    "/{organization_id}",
    operation_id="delete_organization",
)
async def delete_organization(
    request: Request,
    organization_id: str,
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

        # Check if this is the user's last organization
        org_count = await db_manager_ee.count_organizations_by_owner(
            str(request.state.user_id)
        )
        if org_count <= 1:
            return JSONResponse(
                {
                    "detail": "Cannot delete your last organization. You must have at least one organization."
                },
                status_code=400,
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

    except Exception:
        log.error(
            "Unexpected error while deleting organization",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while deleting the organization.",
        )
