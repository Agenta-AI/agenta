from typing import List

from fastapi.responses import JSONResponse
from fastapi import Request, BackgroundTasks

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager
from oss.src.utils.common import is_ee
from oss.src.utils.common import APIRouter
from oss.src.models.api.organization_models import (
    Organization,
    OrganizationDetails,
    OrganizationMember,
)
from oss.src.services import db_manager, organization_service
from oss.src.models.api.workspace_models import (
    InviteRequest,
    ResendInviteRequest,
    InviteToken,
)

if is_ee():
    from ee.src.utils.permissions import check_rbac_permission
    from ee.src.models.api.workspace_models import WorkspaceRole
    from ee.src.services import db_manager_ee, workspace_manager
    from ee.src.services.selectors import (
        get_user_org_and_workspace_id,
    )
    from ee.src.services.organization_service import notify_org_admin_invitation

    from ee.src.utils.entitlements import (
        check_entitlements,
        Tracker,
        Gauge,
        NOT_ENTITLED_RESPONSE,
    )

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
        organizations_db = await db_manager_ee.get_organizations_by_list_ids(
            user_org_workspace_data["organization_ids"]
        )
    else:
        workspaces_db = await db_manager.get_workspaces()
        active_workspace = next(iter(workspaces_db), None)
        if not active_workspace:
            return []

        organizations_db = await db_manager.get_organizations()

    response = [
        Organization(
            id=str(organization_db.id),
            name=str(organization_db.name),
            owner=organization_db.owner,
            description=str(organization_db.description),
            type=organization_db.type,  # type: ignore
            workspaces=[str(active_workspace.id)] if not is_ee() else [],
            is_paying=organization_db.is_paying if is_ee() else None,
        ).model_dump(exclude_unset=True)
        for organization_db in organizations_db
    ]
    return response


@router.get(
    "/{org_id}/",
    operation_id="fetch_organization_details",
    response_model=OrganizationDetails,
)
async def fetch_organization_details(
    org_id: str,
    request: Request,
):
    """Return the details of the organization."""

    workspaces_db = await db_manager.get_workspaces()
    active_workspace = next(iter(workspaces_db), None)
    if not active_workspace:
        return {}

    organization_owner = await db_manager.get_organization_owner(organization_id=org_id)
    project_invitations = await db_manager.get_project_invitations(
        project_id=request.state.project_id
    )
    organization_db = await db_manager.get_organization_by_id(organization_id=org_id)

    invited_members = [
        {
            "user": {
                "id": str(invitation.id),
                "email": invitation.email,
                "username": invitation.email.split("@")[0],
                "status": "pending" if not invitation.used else "member",
                "created_at": str(invitation.created_at),
            },
            "roles": [
                {
                    "role_name": "editor",
                    "role_description": "Can edit workspace content, but cannot manage members or roles.",
                }
            ],
        }
        for invitation in project_invitations
    ]

    owner = [
        {
            "user": OrganizationMember(
                id=str(organization_owner.id),
                email=str(organization_owner.email),
                status="member",
                username=str(organization_owner.username),
                created_at=str(organization_owner.created_at),
            ).model_dump(exclude_none=True),
            "roles": [
                {
                    "role_name": "owner",
                    "role_description": "Can fully manage the workspace, including adding and removing members.",
                }
            ],
        }
    ]

    # Merge invited members
    members = invited_members + owner

    return OrganizationDetails(
        id=str(organization_db.id),
        name=str(organization_db.name),
        owner=organization_db.owner,
        description=str(organization_db.description),
        type=organization_db.type,  # type: ignore
        default_workspace={
            "id": str(active_workspace.id),
            "name": str(active_workspace.name),
            "description": str(active_workspace.description),
            "type": active_workspace.type,  # type: ignore
            "members": members,
        },
        workspaces=[str(active_workspace.id)],
    ).model_dump(exclude_unset=True)


@router.post(
    "/{org_id}/workspaces/{workspace_id}/invite/",
    operation_id="invite_user_to_workspace",
)
async def invite_user_to_organization(
    org_id: str,
    payload: List[InviteRequest],
    workspace_id: str,
    request: Request,
):
    """
    Assigns a role to a user in an organization.

    Args:
        org_id (str): The ID of the organization.
        payload (InviteRequest): The payload containing the organization id, user email, and role to assign.
        workspace_id (str): The ID of the workspace.

    Returns:
        bool: True if the role was successfully assigned, False otherwise.

    Raises:
        HTTPException: If the user does not have permission to perform this action.
        HTTPException: If there is an error assigning the role to the user.
    """

    if len(payload) != 1:
        return JSONResponse(
            status_code=400,
            content={"detail": "Only one user can be invited at a time."},
        )

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

        owner = await db_manager.get_organization_owner(org_id)
        owner_domain = owner.email.split("@")[-1].lower() if owner else ""
        user_domain = payload[0].email.split("@")[-1].lower()
        skip_meter = owner_domain != "agenta.ai" and user_domain == "agenta.ai"

        if not skip_meter:
            check, _, _ = await check_entitlements(
                organization_id=request.state.organization_id,
                key=Gauge.USERS,
                delta=1,
            )

            if not check:
                return NOT_ENTITLED_RESPONSE(Tracker.GAUGES)

        invite_user = await workspace_manager.invite_user_to_workspace(
            payload=payload,
            org_id=org_id,
            project_id=str(project.id),
            workspace_id=workspace_id,
            user_uid=request.state.user_id,
        )
        return invite_user

    invitation_response = await organization_service.invite_user_to_organization(
        payload=payload[0],
        project_id=request.state.project_id,
        user_id=request.state.user_id,
    )
    return invitation_response


@router.post(
    "/{org_id}/workspaces/{workspace_id}/invite/resend/",
    operation_id="resend_invitation",
)
async def resend_user_invitation_to_organization(
    org_id: str,
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

        invite_user = await workspace_manager.resend_user_workspace_invite(
            payload=payload,
            project_id=request.state.project_id,
            org_id=org_id,
            workspace_id=workspace_id,
            user_uid=request.state.user_id,
        )
        return invite_user

    invite_user = await organization_service.resend_user_organization_invite(
        payload,
        project_id=request.state.project_id,
        user_id=request.state.user_id,
    )
    return invite_user


@router.post(
    "/{org_id}/workspaces/{workspace_id}/invite/accept/",
    operation_id="accept_invitation",
)
async def accept_organization_invitation(
    org_id: str,
    workspace_id: str,
    project_id: str,
    payload: InviteToken,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """Accept an invitation to an organization.

    Raises:
        HTTPException: _description_; status_code: 500
        HTTPException: Invitation not found or has expired; status_code: 400
        HTTPException: You already belong to this organization; status_code: 400

    Returns:
        JSONResponse: Accepted invitation to workspace; status_code: 200
    """

    if is_ee():
        workspace = await workspace_manager.get_workspace(workspace_id)
        organization = await db_manager_ee.get_organization(org_id)
        user = await db_manager.get_user(request.state.user_id)

        accept_invitation = await workspace_manager.accept_workspace_invitation(
            token=payload.token,
            project_id=project_id,
            organization=organization,
            workspace=workspace,
            user=user,
        )

        if accept_invitation:
            background_tasks.add_task(notify_org_admin_invitation, workspace, user)

    else:
        await organization_service.accept_organization_invitation(
            token=payload.token,
            organization_id=org_id,
            email=payload.email,
        )
    return JSONResponse({"message": "Added user to workspace"}, status_code=200)
