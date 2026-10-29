from typing import List, Dict, Optional
from uuid import UUID

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager, organization_service
from oss.src.utils.common import APIRouter, is_ee
from oss.src.models.api.workspace_models import Workspace, UserRole

from oss.src.core.access.permissions.service import (
    check_action_access,
    check_organization_write,
)
from oss.src.core.access.permissions.types import (
    DefaultRole,
    Permission,
    RequiredRole,
)
from oss.src.core.memberships.service import get_memberships_service
from oss.src.core.memberships.types import MemberNotFound, OrganizationOwnerProtected
from oss.src.core.access.controls import get_role, get_roles
from oss.src.services.db_manager import get_project_by_workspace

if is_ee():
    from ee.src.core.access.entitlements.service import (
        check_entitlements,
        scope_from,
        Gauge,
    )


router = APIRouter()

log = get_module_logger(__name__)

_PERMISSION_DENIED = (
    "You do not have permission to perform this action. "
    "Please contact your Organization Owner"
)


def _owner_protected() -> HTTPException:
    # Today's owner-protection body shape, which the classic /w app reads.
    return HTTPException(status_code=403, detail={"message": _PERMISSION_DENIED})


async def _organization_write(request: Request, project) -> bool:
    # Role changes and removals change the member across the whole organization, so
    # an API key or a run credential must also be of the organization's default
    # project, not only of this workspace's.
    return await check_organization_write(
        user_uid=request.state.user_id,
        organization_id=str(project.organization_id),
        permission=Permission.MODIFY_USER_ROLES,
    )


def _actor(request: Request) -> Optional[UUID]:
    user_id = getattr(request.state, "user_id", None)
    return UUID(str(user_id)) if user_id else None


async def _set_member_role(
    *,
    organization_id,
    user_id,
    role: str,
    actor_user_id,
) -> None:
    # Ownership moves only through the transfer endpoint. As before M1, this endpoint
    # neither grants `owner` nor changes a member who holds it (the owner role passes
    # every check, including deleting the workspace).
    if role == "owner":
        raise _owner_protected()
    member = await get_memberships_service().fetch_organization_member(
        organization_id=UUID(str(organization_id)), user_id=UUID(str(user_id))
    )
    if member is not None and member.role == "owner":
        raise _owner_protected()
    try:
        await get_memberships_service().set_member_role(
            organization_id=UUID(str(organization_id)),
            user_id=UUID(str(user_id)),
            role=role,
            must_exist=True,
            actor_user_id=UUID(str(actor_user_id)) if actor_user_id else None,
        )
    except OrganizationOwnerProtected as exc:
        raise _owner_protected() from exc
    except MemberNotFound as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc


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

    # Workspace removal step 2: one item per organization of the user (design D6).
    organizations_db = await db_manager.get_user_organizations(request.state.user_id)
    # A user can hold two membership rows in one organization: one item each.
    organizations_db = list({o.id: o for o in organizations_db}.values())
    return [
        Workspace(
            id=str(organization_db.id),
            name=organization_db.name or "",
            description=organization_db.description,
            type="default",  # type: ignore
        )
        for organization_db in organizations_db
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


@router.get(
    "/permissions/",
    operation_id="get_all_workspace_permissions",
    response_model=List[Permission],
)
async def get_all_workspace_permissions() -> List[Permission]:
    """Get all available workspace permissions."""

    try:
        permissions = await organization_service.get_all_workspace_permissions()
        return sorted(permissions)
    except Exception:
        log.error(
            "Unexpected error while fetching workspace permissions", exc_info=True
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
        ) and await _organization_write(request, project)
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

        user = await db_manager.get_user_with_email(payload.email)
        if user is None:
            raise HTTPException(status_code=404, detail="User not found.")

        await _set_member_role(
            organization_id=project.organization_id,
            user_id=user.id,
            role=payload.role,
            actor_user_id=request.state.user_id,
        )
        return True
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
        ) and await _organization_write(request, project)
        if not has_permission:
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "You do not have permission to perform this action. Please contact your Organization Owner"
                },
            )

        if not role or get_role("workspace", role) is None:
            return JSONResponse(
                status_code=400, content={"detail": "Workspace role is invalid."}
            )

        user = await db_manager.get_user_with_email(email)
        if user is None:
            raise HTTPException(status_code=404, detail="User not found.")

        member = await get_memberships_service().fetch_organization_member(
            organization_id=project.organization_id,
            user_id=user.id,
        )
        if member is None:
            raise HTTPException(status_code=404, detail="User not found.")

        # Removing the active role reverts the member to the default floor role;
        # removing any other role changes nothing.
        if member.role == role:
            await _set_member_role(
                organization_id=project.organization_id,
                user_id=user.id,
                role=DefaultRole.VIEWER.value,
                actor_user_id=request.state.user_id,
            )
        return True
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

    project = await get_project_by_workspace(workspace_id)
    has_permission = await check_action_access(
        user_uid=request.state.user_id,
        project_id=str(project.id),
        role=RequiredRole.ADMIN,
    ) and await _organization_write(request, project)
    if not has_permission:
        return JSONResponse(
            status_code=403,
            content={
                "detail": "You do not have permission to perform this action. Please contact your Organization Owner"
            },
        )

    # An owner-role member is not removed here (as before M1), and the refusal
    # comes before the EE user gauge moves.
    target = await db_manager.get_user_with_email(email)
    if target is not None:
        member = await get_memberships_service().fetch_organization_member(
            organization_id=UUID(str(project.organization_id)),
            user_id=UUID(str(target.id)),
        )
        if member is not None and member.role == "owner":
            raise _owner_protected()

    if is_ee():
        # Decrement the user gauge in the *target* workspace's owning org
        # (loaded via the path-param `{workspace_id}`), not the caller's
        # ambient org. The agenta.ai skip-meter exemption and the decrement
        # must agree on which organization is being acted on.
        owner = await db_manager.get_organization_owner(str(project.organization_id))
        owner_domain = owner.email.split("@")[-1].lower() if owner else ""
        user_domain = email.split("@")[-1].lower()
        skip_meter = owner_domain != "agenta.ai" and user_domain == "agenta.ai"

        if not skip_meter:
            await check_entitlements(  # type: ignore
                key=Gauge.USERS,  # type: ignore
                delta=-1,
                scope=scope_from(organization_id=project.organization_id),  # type: ignore
            )

    try:
        await get_memberships_service().remove_member(
            organization_id=project.organization_id,
            email=email,
            actor_user_id=_actor(request),
        )
    except OrganizationOwnerProtected as exc:
        raise _owner_protected() from exc

    return True
