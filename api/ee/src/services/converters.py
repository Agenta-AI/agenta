from typing import List, Any
from datetime import datetime, timezone

from oss.src.services import db_manager
from ee.src.services import db_manager_ee
from ee.src.core.workspaces.types import WorkspaceResponse
from ee.src.core.entitlements.controls import (
    get_role_description,
    get_role_permissions,
)
from ee.src.models.shared_models import Permission
from oss.src.models.db_models import WorkspaceDB


def _role_slug(role: Any) -> str:
    """Normalize an enum or string role to its slug form."""
    return role.value if hasattr(role, "value") else str(role)


def _expand_permissions(slugs: List[str]) -> List[str]:
    """Expand the `"*"` wildcard to the full list of Permission enum values.

    Why: `WorkspacePermission.permissions` is typed as `List[Permission]` and
    the owner role stores `["*"]` as a wildcard. Pydantic rejects `"*"` since
    it's not an enum member, so we materialize it at the API boundary.
    """
    if "*" not in slugs:
        return slugs
    return [p.value for p in Permission]


async def get_workspace_in_format(
    workspace: WorkspaceDB,
    include_members: bool = True,
) -> WorkspaceResponse:
    """Converts the workspace object to the WorkspaceResponse model.

    Arguments:
        workspace (WorkspaceDB): The workspace object
        include_members (bool): Whether to include workspace members. Defaults to True.

    Returns:
        WorkspaceResponse: The workspace object in the WorkspaceResponse model
    """

    members = []

    if include_members:
        project = await db_manager_ee.get_project_by_workspace(
            workspace_id=str(workspace.id)
        )
        project_members = await db_manager_ee.get_project_members(
            project_id=str(project.id)
        )
        invitations = await db_manager_ee.get_project_invitations(
            project_id=str(project.id), invitation_used=False
        )

        if len(invitations) > 0:
            for invitation in invitations:
                if not invitation.used and str(invitation.project_id) == str(
                    project.id
                ):
                    user = await db_manager.get_user_with_email(invitation.email)
                    member_dict = {
                        "user": {
                            "id": str(user.id) if user else invitation.email,
                            "email": user.email if user else invitation.email,
                            "username": (
                                user.username
                                if user
                                else invitation.email.split("@")[0]
                            ),
                            "status": (
                                "pending"
                                if invitation.expiration_date
                                > datetime.now(timezone.utc)
                                else "expired"
                            ),
                            "created_at": (
                                str(user.created_at)
                                if user
                                else (
                                    str(invitation.created_at)
                                    if str(invitation.created_at)
                                    else None
                                )
                            ),
                        },
                        "roles": [
                            {
                                "role_name": invitation.role,
                                "role_description": get_role_description(
                                    "workspace", _role_slug(invitation.role)
                                ),
                            }
                        ],
                    }
                    members.append(member_dict)

        for project_member in project_members:
            member_role = project_member.role
            member_dict = {
                "user": {
                    "id": str(project_member.user.id),
                    "email": project_member.user.email,
                    "username": project_member.user.username,
                    "status": "member",
                    "created_at": str(project_member.user.created_at),
                },
                "roles": (
                    [
                        {
                            "role_name": member_role,
                            "role_description": get_role_description(
                                "project", _role_slug(member_role)
                            ),
                            "permissions": _expand_permissions(
                                get_role_permissions("project", _role_slug(member_role))
                            ),
                        }
                    ]
                    if member_role
                    else []
                ),
            }
            members.append(member_dict)

    workspace_response = WorkspaceResponse(
        id=str(workspace.id),
        name=workspace.name,
        description=workspace.description,
        type=workspace.type,
        members=members,
        organization=str(workspace.organization_id),
        created_at=str(workspace.created_at),
        updated_at=str(workspace.updated_at),
    )
    return workspace_response


async def get_all_workspace_permissions() -> List[Permission]:
    """
    Retrieve all workspace permissions.

    Returns:
        List[Permission]: A list of all workspace permissions in the DB.
    """
    workspace_permissions = list(Permission)
    return workspace_permissions


def get_all_workspace_permissions_by_role(role_name: str) -> List[str]:
    """Retrieve all permissions assigned to a workspace role.

    Resolved via access-controls (env-overridable via AGENTA_ACCESS_ROLES).
    """
    return _expand_permissions(get_role_permissions("workspace", role_name))
