from typing import List
from uuid import UUID

from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager
from oss.src.utils.common import is_ee
from oss.src.utils.common import APIRouter
from oss.src.models.api.organization_models import (
    Organization,
    OrganizationDetails,
    CreateOrganizationPayload,
    OrganizationUpdate,
)
from oss.src.services import organization_service
from oss.src.services.organization_service import (
    InviteNotFoundError,
    InviteExpiredError,
    InviteAlreadyAcceptedError,
    InviteEmailMismatchError,
)
from oss.src.models.api.workspace_models import (
    InviteRequest,
    ResendInviteRequest,
    InviteToken,
    CreateWorkspace,
    UpdateWorkspace,
    WorkspaceResponse,
)
from oss.src.core.access.permissions.service import (
    check_action_access,
    check_rbac_permission,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.organizations.exceptions import (
    OrganizationCreationNotAllowedError,
)
from oss.src.services.db_manager import get_user_org_and_workspace_id


if is_ee():
    from ee.src.core.access.entitlements.service import (
        check_entitlements,
        scope_from,
        Tracker,
        Gauge,
        Flag,
        NOT_ENTITLED_RESPONSE,
    )
    from ee.src.core.organizations.service import (
        update_organization as update_organization_ee,
    )
    from ee.src.core.organizations.exceptions import OrganizationSlugConflictError

router = APIRouter()

log = get_module_logger(__name__)


@router.get("/", response_model=list[Organization], operation_id="list_organizations")
async def list_organizations(
    request: Request,
):
    """
    Returns a list of organizations associated with the user's session.

    Returns:
        list[Organization]: A list of organizations associated with the user's session.

    Raises:
        HTTPException: If there is an error retrieving the organizations from the database.
    """

    if is_ee():
        user_org_workspace_data: dict = await get_user_org_and_workspace_id(
            request.state.user_id
        )
        organizations_db = await db_manager.get_organizations_by_list_ids(
            user_org_workspace_data["organization_ids"]
        )
        workspaces_by_org = {}
    else:
        organizations_db = await db_manager.get_user_organizations(
            request.state.user_id
        )

        user_workspaces = await db_manager.get_user_workspaces(request.state.user_id)
        workspaces_by_org = {}
        for workspace_db in user_workspaces:
            workspaces_by_org.setdefault(workspace_db.organization_id, []).append(
                str(workspace_db.id)
            )

    response = [
        Organization(
            id=str(organization_db.id),
            slug=str(organization_db.slug),
            #
            name=str(organization_db.name),
            description=str(organization_db.description),
            #
            flags=organization_db.flags,
            tags=organization_db.tags,
            meta=organization_db.meta,
            #
            owner_id=organization_db.owner_id,
            #
            workspaces=workspaces_by_org.get(organization_db.id, []),
        ).model_dump(exclude_unset=True)
        for organization_db in organizations_db
    ]
    return response


@router.get(
    "/{organization_id}",
    operation_id="fetch_organization_details",
    response_model=OrganizationDetails,
)
async def fetch_organization_details(
    organization_id: str,
    request: Request,
):
    """Return the details of the organization."""

    user_organizations = await db_manager.get_user_organizations(request.state.user_id)
    if not any(str(org.id) == str(organization_id) for org in user_organizations):
        return JSONResponse(
            status_code=403,
            content={"detail": "Not a member of this organization."},
        )

    # Both editions: return the org with its default workspace and real project
    # members + permissions (demo orgs skip members). tags/meta are included.
    organization = await db_manager.get_organization_by_id(
        organization_id=organization_id
    )
    if organization is None:
        return {}

    return await db_manager.get_org_details(organization)


@router.post(
    "/{organization_id}/workspaces/{workspace_id}/invite",
    operation_id="invite_user_to_workspace",
)
async def invite_user_to_organization(
    organization_id: str,
    payload: List[InviteRequest],
    workspace_id: str,
    request: Request,
):
    """
    Assigns a role to a user in an organization.

    Args:
        organization_id (str): The ID of the organization.
        payload (InviteRequest): The payload containing the organization id, user email, and role to assign.
        workspace_id (str): The ID of the workspace.

    Returns:
        bool: True if the role was successfully assigned, False otherwise.

    Raises:
        HTTPException: If the user does not have permission to perform this action.
        HTTPException: If there is an error assigning the role to the user.
    """

    try:
        if len(payload) != 1:
            return JSONResponse(
                status_code=400,
                content={"detail": "Only one user can be invited at a time."},
            )

        project = await db_manager.get_project_by_workspace(workspace_id)
        if str(project.organization_id) != str(organization_id):
            return JSONResponse(
                status_code=404,
                content={"detail": "Workspace not found for organization."},
            )
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(project.id),
            permission=Permission.ADD_USER_TO_WORKSPACE,
        )
        if not has_permission:
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "You do not have permission to perform this action. Please contact your Organization Owner"
                },
            )

        if is_ee():
            owner = await db_manager.get_organization_owner(organization_id)
            owner_domain = owner.email.split("@")[-1].lower() if owner else ""
            user_domain = payload[0].email.split("@")[-1].lower()
            skip_meter = owner_domain != "agenta.ai" and user_domain == "agenta.ai"

            if not skip_meter:
                # The route operates on the workspace selected by the
                # path-param `{organization_id}`. Project the entitlement
                # check onto the target org so the right org's user
                # gauge gets the `+1`, not the caller's ambient org.
                check, _, _ = await check_entitlements(  # type: ignore
                    key=Gauge.USERS,  # type: ignore
                    delta=1,
                    scope=scope_from(organization_id=UUID(organization_id)),  # type: ignore
                )

                if not check:
                    return NOT_ENTITLED_RESPONSE(Tracker.GAUGES)

        invitation_response = await organization_service.invite_user_to_organization(
            payload=payload[0],
            project_id=str(project.id),
            user_id=request.state.user_id,
            organization_id=organization_id,
        )
        return invitation_response
    except Exception:
        log.error(
            "Invite user failed",
            organization_id=organization_id,
            workspace_id=workspace_id,
            project_id=getattr(request.state, "project_id", None),
            user_id=getattr(request.state, "user_id", None),
            exc_info=True,
        )
        raise


@router.post(
    "/{organization_id}/workspaces/{workspace_id}/invite/resend",
    operation_id="resend_invitation",
)
async def resend_user_invitation_to_organization(
    organization_id: str,
    workspace_id: str,
    payload: ResendInviteRequest,
    request: Request,
):
    """Resend an invitation to a user to an Organization.

    Raises:
        HTTPException: _description_; status_code: 500
        HTTPException: Invitation not found or has expired; status_code: 400
        HTTPException: You already belong to this organization; status_code: 400

    Returns:
        JSONResponse: Resent invitation to user; status_code: 200
    """

    project = await db_manager.get_project_by_workspace(workspace_id)
    if str(project.organization_id) != str(organization_id):
        return JSONResponse(
            status_code=404,
            content={"detail": "Workspace not found for organization."},
        )
    has_permission = await check_action_access(
        user_uid=request.state.user_id,
        project_id=str(project.id),
        permission=Permission.ADD_USER_TO_WORKSPACE,
    )
    if not has_permission:
        return JSONResponse(
            status_code=403,
            content={
                "detail": "You do not have permission to perform this action. Please contact your Organization Owner"
            },
        )

    invite_user = await organization_service.resend_user_organization_invite(
        payload,
        project_id=str(project.id),
        user_id=request.state.user_id,
        organization_id=organization_id,
    )
    return invite_user


@router.post(
    "/{organization_id}/workspaces/{workspace_id}/invite/accept",
    operation_id="accept_invitation",
)
async def accept_organization_invitation(
    organization_id: str,
    workspace_id: str,
    project_id: str,
    payload: InviteToken,
    request: Request,
):
    """Accept an invitation to an organization.

    Raises:
        HTTPException: _description_; status_code: 500
        HTTPException: Invitation not found or has expired; status_code: 400
        HTTPException: You already belong to this organization; status_code: 400

    Returns:
        JSONResponse: Accepted invitation to workspace; status_code: 200
    """

    try:
        await organization_service.accept_organization_invitation(
            token=payload.token,
            organization_id=organization_id,
            email=payload.email,
            session_email=request.state.user_email,
        )
    except InviteNotFoundError as e:
        raise HTTPException(
            status_code=400,
            detail={"error": e.code, "message": "Invitation does not exist."},
        ) from e
    except InviteEmailMismatchError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error": e.code,
                "message": "Invitation is addressed to a different user.",
            },
        ) from e
    except InviteExpiredError as e:
        raise HTTPException(
            status_code=410,
            detail={"error": e.code, "message": "Invitation has expired."},
        ) from e
    except InviteAlreadyAcceptedError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "error": e.code,
                "message": "Invitation has already been accepted.",
            },
        ) from e

    return JSONResponse({"message": "Added user to workspace"}, status_code=200)


async def _check_org_owner(organization_id: str, user_id: str) -> bool:
    organization = await db_manager.get_organization_by_id(
        organization_id=organization_id
    )
    return organization is not None and str(organization.owner_id) == str(user_id)


@router.post("/", operation_id="create_organization")
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

        # OSS-owned; EE subscription provisioning layers in via is_ee() inside.
        from oss.src.services.commoners import (  # noqa: PLC0415
            create_organization_for_user,
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


@router.put("/{organization_id}", operation_id="update_organization")
@router.patch("/{organization_id}", operation_id="patch_organization")
async def update_organization(
    request: Request,
    organization_id: str,
    payload: OrganizationUpdate,
):
    if (
        not payload.name
        and not payload.description
        and not payload.slug
        and not payload.flags
    ):
        return JSONResponse(
            {"detail": "Please provide a field to update"},
            status_code=400,
        )

    if not await _check_org_owner(organization_id, request.state.user_id):
        return JSONResponse(
            {"detail": "You do not have permission to perform this action"},
            status_code=403,
        )

    try:
        if is_ee():
            # EE accepts slug/flags; flag changes are entitlement-gated and run
            # through SSO/domain/auth-lockout validation in the EE service.
            if payload.flags is not None:
                check, _, _ = await check_entitlements(
                    key=Flag.ACCESS,
                    scope=scope_from(organization_id=UUID(organization_id)),
                )
                if not check:
                    return NOT_ENTITLED_RESPONSE(Tracker.FLAGS)

            organization = await update_organization_ee(organization_id, payload)
            return organization

        organization = await db_manager.update_organization(
            organization_id=organization_id,
            values_to_update=payload.model_dump(exclude_unset=True),
        )
        return JSONResponse(
            {
                "id": str(organization.id),
                "name": organization.name,
                "description": organization.description,
            },
            status_code=200,
        )

    except ValueError:
        # Slug validation errors (format, immutability, personal org, etc.)
        return JSONResponse(
            {"detail": "Invalid request data for organization update."},
            status_code=400,
        )
    except Exception as exc:
        if is_ee() and isinstance(exc, OrganizationSlugConflictError):
            return JSONResponse(
                {
                    "detail": "Slug already in use. Please select another slug or contact your administrator."
                },
                status_code=409,
            )
        log.error(
            "Unexpected error while updating organization",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while updating the organization.",
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
    if not await _check_org_owner(organization_id, request.state.user_id):
        return JSONResponse(
            {"detail": "Only the organization owner can transfer ownership"},
            status_code=403,
        )

    try:
        organization = await db_manager.transfer_organization_ownership(
            organization_id=organization_id,
            new_owner_id=new_owner_id,
            current_user_id=str(request.state.user_id),
        )

        return JSONResponse(
            {
                "organization_id": str(organization.id),
                "owner_id": str(organization.owner_id),
            },
            status_code=200,
        )

    except ValueError:
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


@router.delete("/{organization_id}", operation_id="delete_organization")
async def delete_organization(
    request: Request,
    organization_id: str,
):
    """Delete an organization (owner only)."""
    if not await _check_org_owner(organization_id, request.state.user_id):
        return JSONResponse(
            {"detail": "You do not have permission to perform this action"},
            status_code=403,
        )

    try:
        org_count = await db_manager.count_organizations_by_owner(
            str(request.state.user_id)
        )
        if org_count <= 1:
            return JSONResponse(
                {
                    "detail": "Cannot delete your last organization. You must have at least one organization."
                },
                status_code=400,
            )

        await db_manager.delete_organization(organization_id)

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
    """Create a new workspace in an organization (owner only)."""
    try:
        if not await _check_org_owner(organization_id, request.state.user_id):
            return JSONResponse(
                {"detail": "You do not have permission to perform this action"},
                status_code=403,
            )

        if not payload.name:
            return JSONResponse(
                {"detail": "Please provide a name to create a workspace"},
                status_code=400,
            )

        return await organization_service.create_new_workspace(
            payload, organization_id, request.state.user_id
        )

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
    """Update a workspace's details (requires EDIT_WORKSPACE permission)."""
    try:
        user_org_workspace_data = await get_user_org_and_workspace_id(
            request.state.user_id
        )
        project = await db_manager.get_project_by_workspace(workspace_id)
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

        return await organization_service.update_workspace(payload, workspace_id)

    except Exception:
        log.error(
            "Unexpected error while updating workspace",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while updating the workspace.",
        )
