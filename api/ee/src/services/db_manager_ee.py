from typing import Any, List, Set, Union, NoReturn
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from sqlalchemy import delete, update, func
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only
from sqlalchemy.exc import NoResultFound, MultipleResultsFound
from sqlalchemy.exc import IntegrityError

from oss.src.utils.logging import get_module_logger

from oss.src.dbs.postgres.shared.engine import (
    get_transactions_engine,
)
from oss.src.services import db_manager
from oss.src.services.db_manager import (  # noqa: F401 — moved OSS-ward, re-exported
    get_default_workspace_id,
    add_user_to_organization,
    add_user_to_workspace,
    add_user_to_project,
    add_user_to_workspace_and_org,
    transfer_organization_ownership,
    count_organizations_by_owner,
    delete_organization,
    get_organization,
    get_workspace_members,
    get_project_members,
    get_user_org_and_workspace_id,
    get_project_by_workspace,
    update_user_roles,
)
from ee.src.core.workspaces.types import (
    UpdateWorkspace,
    CreateWorkspace,
    WorkspaceResponse,
)
from ee.src.core.organizations.types import (
    Organization,
    OrganizationUpdate,
)
from ee.src.core.access.permissions.types import Permission, RequiredRole
from ee.src.core.access.controls import (
    get_roles,
    get_role_description,
    get_role_permissions,
)

from oss.src.models.db_models import (
    OrganizationDB,
    WorkspaceDB,
    ProjectDB,
)

from ee.src.models.db_models import (
    OrganizationMemberDB,
    WorkspaceMemberDB,
    ProjectMemberDB,
)
from oss.src.models.db_models import (
    UserDB,
    InvitationDB,
)

from ee.src.core.organizations.exceptions import (
    OrganizationSlugConflictError,
)

from ee.src.dbs.postgres.organizations.dao import (
    OrganizationProvidersDAO,
    OrganizationDomainsDAO,
)

from oss.src.utils.env import env


log = get_module_logger(__name__)


async def get_organizations_by_list_ids(organization_ids: List) -> List[OrganizationDB]:
    """
    Retrieve organizations from the database by their IDs.

    Args:
        organization_ids (List): A list of organization IDs to retrieve.

    Returns:
        List: A list of dictionaries representing the retrieved organizations.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        organization_uuids = [
            uuid.UUID(organization_id) for organization_id in organization_ids
        ]
        query = select(OrganizationDB).where(OrganizationDB.id.in_(organization_uuids))
        result = await session.execute(query)
        organizations = result.scalars().all()
        return organizations


async def count_organization_members(organization_id: str) -> int:
    """
    Count the number of members in an organization.

    Args:
        organization_id (str): The ID of the organization.

    Returns:
        int: The count of members in the organization.
    """
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(func.count(OrganizationMemberDB.id)).where(
                OrganizationMemberDB.organization_id == uuid.UUID(organization_id)
            )
        )
        return result.scalar() or 0


async def get_organization_workspaces(organization_id: str):
    """
    Retries workspaces belonging to an organization.

    Args:
        organization_id (str): The ID of the organization
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(WorkspaceDB)
            .filter_by(organization_id=uuid.UUID(organization_id))
            .options(  # type: ignore
                load_only(WorkspaceDB.id, WorkspaceDB.organization_id)
            )
        )
        workspaces = result.scalars().all()
        return workspaces


async def get_workspace_administrators(workspace: WorkspaceDB) -> List[UserDB]:
    """
    Retrieve the administrators of a workspace.

    Administrators are members whose role is ADMIN or OWNER.
    """

    # Fetch all membership rows for this workspace
    members = await get_workspace_members(workspace_id=str(workspace.id))

    admin_user_ids = [
        str(member.user_id)
        for member in members
        if member.role in (RequiredRole.ADMIN, RequiredRole.OWNER)
    ]

    administrators: List[UserDB] = []
    for user_id in admin_user_ids:
        user = await db_manager.get_user_with_id(user_id=user_id)
        if user:
            administrators.append(user)

    return administrators


async def create_project(
    project_name: str,
    workspace_id: str,
    organization_id: str,
    session: AsyncSession,
    *,
    is_default: bool = False,
) -> WorkspaceDB:
    """
    Create a new project.

    Args:
        project_name (str): The name of the project.
        workspace_id (str): The ID of the workspace.
        organization_id (str): The ID of the organization.
        session (AsyncSession): The database session.

    Returns:
        WorkspaceDB: The created project.
    """

    project_db = ProjectDB(
        project_name=project_name,
        is_default=is_default,
        organization_id=uuid.UUID(organization_id),
        workspace_id=uuid.UUID(workspace_id),
    )

    session.add(project_db)

    await session.commit()

    log.info(
        "[scopes] project created",
        organization_id=organization_id,
        workspace_id=workspace_id,
        project_id=project_db.id,
    )

    return project_db


async def create_default_project(
    organization_id: str, workspace_id: str, session: AsyncSession
) -> WorkspaceDB:
    """
    Create a default project for an organization.

    Args:
        organization_id (str): The ID of the organization.
        workspace_id (str): The ID of the workspace.
        session (AsyncSession): The database session.

    Returns:
        WorkspaceDB: The created default project.
    """

    project_db = await create_project(
        "Default",
        workspace_id=workspace_id,
        organization_id=organization_id,
        session=session,
        is_default=True,
    )
    return project_db


async def get_default_workspace_id_from_organization(
    organization_id: str,
) -> Union[str, NoReturn]:
    """
    Get the default (first) workspace ID belonging to a user from a organization.

    Args:
        organization_id (str): The ID of the organization.

    Returns:
        str: The default (first) workspace ID.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        workspace_query = await session.execute(
            select(WorkspaceDB)
            .where(
                WorkspaceDB.organization_id == uuid.UUID(organization_id),
            )
            .options(load_only(WorkspaceDB.id))
        )
        workspace = workspace_query.scalars().first()
        if workspace is None:
            raise NoResultFound(
                f"No default workspace for the provided organization_id {organization_id} found"
            )
        return str(workspace.id)


async def create_project_member(
    user_id: str, project_id: str, role: str, session: AsyncSession
) -> None:
    """
    Create a new project member.

    Args:
        user_id (str): The ID of the user.
        project_id (str): The ID of the project.
        role (str): The role of the user in the workspace.
        session (AsyncSession): The database session.
    """

    project = await db_manager.fetch_project_by_id(
        project_id=project_id,
    )

    if not project:
        raise Exception(f"No project found with ID {project_id}")

    project_member = ProjectMemberDB(
        user_id=uuid.UUID(user_id),
        project_id=uuid.UUID(project_id),
        role=role,
    )

    session.add(project_member)

    await session.commit()

    log.info(
        "[scopes] project membership created",
        organization_id=project.organization_id,
        workspace_id=project.workspace_id,
        project_id=project_id,
        user_id=user_id,
        membership_id=project_member.id,
    )


async def create_workspace_db_object(
    session: AsyncSession,
    payload: CreateWorkspace,
    organization: OrganizationDB,
    user: UserDB,
    return_wrk_prj: bool = False,
) -> WorkspaceDB:
    """Create a new workspace.

    Args:
        payload (Workspace): The workspace payload.
        organization (OrganizationDB): The organization that the workspace belongs to.
        user (UserDB): The user that the workspace belongs to.

    Returns:
        Workspace: The created workspace.
    """

    workspace = WorkspaceDB(
        name=payload.name,
        type=payload.type if payload.type else "",
        description=payload.description if payload.description else "",
        organization_id=organization.id,
    )

    session.add(workspace)

    await session.commit()

    log.info(
        "[scopes] workspace created",
        organization_id=organization.id,
        workspace_id=workspace.id,
    )

    # add user as a member to the workspace with the owner role
    workspace_member = WorkspaceMemberDB(
        user_id=user.id,
        workspace_id=workspace.id,
        role="owner",
    )

    session.add(workspace_member)

    await session.commit()
    await session.refresh(workspace, attribute_names=["organization"])

    log.info(
        "[scopes] workspace membership created",
        organization_id=workspace.organization_id,
        workspace_id=workspace.id,
        user_id=user.id,
        membership_id=workspace_member.id,
    )

    project_db = await create_default_project(
        organization_id=str(organization.id),
        workspace_id=str(workspace.id),
        session=session,
    )

    # add user as a member to the project member with the owner role
    await create_project_member(
        user_id=str(user.id),
        project_id=str(project_db.id),
        role=workspace_member.role,
        session=session,
    )

    # add default testsets
    await db_manager.add_default_simple_testsets(
        project_id=str(project_db.id),
        user_id=str(user.id),
    )

    # Create default evaluators and environments for the new project.
    # Import here to avoid circular import at module load time
    from oss.src.core.evaluators.defaults import create_default_evaluators
    from oss.src.core.environments.defaults import create_default_environments

    await create_default_evaluators(
        project_id=project_db.id,
        user_id=user.id,
    )
    await create_default_environments(
        project_id=project_db.id,
        user_id=user.id,
    )

    if return_wrk_prj:
        return workspace, project_db

    return workspace


async def create_workspace(
    payload: CreateWorkspace, organization_id: str, user_uid: str
) -> WorkspaceResponse:
    """
    Create a new workspace.

    Args:
        payload (CreateWorkspace): The workspace payload.
        organization_id (str): The organization id.
        user_uid (str): The user uid.

    Returns:
        Workspace: The created workspace.

    """
    try:
        user = await db_manager.get_user(user_uid)
        organization = await get_organization(organization_id)

        engine = get_transactions_engine()

        async with engine.session() as session:
            user_result = await session.execute(select(UserDB).filter_by(uid=user_uid))
            user = user_result.scalars().first()

            organization_result = await session.execute(
                select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
            )
            organization = organization_result.scalars().first()

            # create workspace
            workspace_db = await create_workspace_db_object(
                session, payload, organization, user
            )

            return await get_workspace_in_format(workspace_db)
    except Exception as e:
        raise e


async def update_workspace(
    payload: UpdateWorkspace, workspace: WorkspaceDB
) -> WorkspaceResponse:
    """
    Update a workspace's details.

    Args:
        workspace (WorkspaceDB): The workspace to update.
        payload (UpdateWorkspace): The data to update the workspace with.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(select(WorkspaceDB).filter_by(id=workspace.id))
        workspace = result.scalars().first()

        if not workspace:
            raise NoResultFound(f"Workspace with id {str(workspace.id)} not found")

        for key, value in payload.dict(exclude_unset=True).items():
            if hasattr(workspace, key):
                setattr(workspace, key, value)

        await session.commit()
        await session.refresh(workspace)

        return await get_workspace_in_format(workspace)


async def check_user_in_workspace_with_email(email: str, workspace_id: str) -> bool:
    """
    Check if a user belongs to a workspace.

    Args:
        email (str): The email of the user to check.
        workspace_id (str): The workspace to check.

    Raises:
        Exception: If there is an error checking if the user belongs to the workspace.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(WorkspaceMemberDB)
            .join(UserDB, UserDB.id == WorkspaceMemberDB.user_id)
            .where(
                UserDB.email == email,
                WorkspaceMemberDB.workspace_id == uuid.UUID(workspace_id),
            )
        )
        workspace_member = result.scalars().first()
        return False if workspace_member is None else True


async def update_organization(
    organization_id: str, payload: OrganizationUpdate
) -> OrganizationDB:
    """
    Update an organization's details.

    Args:
        organization_id (str): The organization to update.
        payload (OrganizationUpdate): The data to update the organization with.

    Returns:
        Organization: The updated organization.

    Raises:
        Exception: If there is an error updating the organization.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = result.scalars().first()

        if not organization:
            raise NoResultFound(f"Organization with id {organization_id} not found")

        # Validate slug updates before applying
        payload_dict = payload.model_dump(exclude_unset=True)
        if "slug" in payload_dict:
            new_slug = payload_dict["slug"]

            # Slug format validation: only lowercase letters and hyphens, max 64 characters
            if new_slug is not None:
                import re

                if len(new_slug) > 64:
                    raise ValueError("Organization slug cannot exceed 64 characters.")
                if not re.match(r"^[a-z-]+$", new_slug):
                    raise ValueError(
                        "Organization slug can only contain lowercase letters (a-z) and hyphens (-)."
                    )

            # Slug immutability: once set, cannot be changed
            if organization.slug is not None and new_slug != organization.slug:
                raise ValueError(
                    f"Organization slug cannot be changed once set. "
                    f"Current slug: '{organization.slug}'"
                )

        # Special handling for flags: merge instead of replace
        if "flags" in payload_dict:
            new_flags = payload_dict["flags"]
            if new_flags is not None:
                # Get existing flags or initialize with defaults
                existing_flags = organization.flags or {}

                # Start with complete defaults
                default_flags = {
                    "is_demo": False,
                    "allow_email": env.auth.email_enabled,
                    "allow_social": env.auth.oidc_enabled,
                    "allow_sso": False,
                    "allow_root": False,
                    "domains_only": False,
                    "auto_join": False,
                }

                # Merge: defaults <- existing <- new
                merged_flags = {**default_flags, **existing_flags, **new_flags}

                # VALIDATION: Ensure at least one auth method is enabled OR allow_root is true
                # This prevents organizations from being locked out
                allow_email = merged_flags.get("allow_email", False)
                allow_social = merged_flags.get("allow_social", False)
                allow_sso = merged_flags.get("allow_sso", False)
                allow_root = merged_flags.get("allow_root", False)

                changing_auth_flags = any(
                    key in new_flags
                    for key in ("allow_email", "allow_social", "allow_sso")
                )
                changing_auto_join = "auto_join" in new_flags
                changing_domains_only = "domains_only" in new_flags

                if changing_auth_flags and allow_sso:
                    providers_dao = OrganizationProvidersDAO(session)
                    providers = await providers_dao.list_by_organization(
                        organization_id=organization_id
                    )
                    active_valid = [
                        provider
                        for provider in providers
                        if (provider.flags or {}).get("is_active")
                        and (provider.flags or {}).get("is_valid")
                    ]
                    if not active_valid:
                        raise ValueError(
                            "SSO cannot be enabled until at least one SSO provider is "
                            "active and verified."
                        )
                    if not allow_email and not allow_social:
                        if not active_valid:
                            raise ValueError(
                                "SSO-only authentication requires at least one SSO provider to "
                                "be active and verified."
                            )

                if changing_auto_join and merged_flags.get("auto_join", False):
                    domains_dao = OrganizationDomainsDAO(session)
                    domains = await domains_dao.list_by_organization(
                        organization_id=organization_id
                    )
                    has_verified_domain = any(
                        (domain.flags or {}).get("is_verified") for domain in domains
                    )
                    if not has_verified_domain:
                        raise ValueError(
                            "Auto-join requires at least one verified domain."
                        )

                if changing_domains_only and merged_flags.get("domains_only", False):
                    domains_dao = OrganizationDomainsDAO(session)
                    domains = await domains_dao.list_by_organization(
                        organization_id=organization_id
                    )
                    has_verified_domain = any(
                        (domain.flags or {}).get("is_verified") for domain in domains
                    )
                    if not has_verified_domain:
                        raise ValueError(
                            "Domains-only requires at least one verified domain."
                        )

                # Check if all auth methods are disabled
                all_auth_disabled = not (allow_email or allow_social or allow_sso)

                if all_auth_disabled and not allow_root:
                    # Auto-enable allow_root to prevent lockout
                    merged_flags["allow_root"] = True
                    log.warning(
                        f"All authentication methods disabled for organization {organization_id}. "
                        f"Auto-enabling allow_root to prevent lockout."
                    )

                organization.flags = merged_flags
            # Remove flags from payload_dict to avoid setting it again below
            del payload_dict["flags"]

        # Set all other attributes
        for key, value in payload_dict.items():
            if hasattr(organization, key):
                setattr(organization, key, value)

        try:
            await session.commit()
        except Exception as e:
            if isinstance(e, IntegrityError) and "uq_organizations_slug" in str(e):
                raise OrganizationSlugConflictError(
                    slug=payload_dict.get("slug", "unknown")
                ) from e
            raise

        await session.refresh(organization)
        return organization


async def delete_invitation(invitation_id: str) -> bool:
    """
    Delete an invitation from an organization.

    Args:
        invitation (str): The invitation to delete.

    Returns:
        bool: True if the invitation was successfully deleted, False otherwise.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(id=uuid.UUID(invitation_id))
        )

        try:
            invitation = result.scalars().one_or_none()
        except MultipleResultsFound as e:
            log.error(
                f"Critical error: Database returned two rows when retrieving invitation with ID {invitation_id} to delete from Invitations table.",
                exc_info=True,
            )
            raise HTTPException(
                500,
                {
                    "message": f"Error occured while trying to delete invitation with ID {invitation_id} from Invitations table. Error details: {str(e)}"
                },
            )

        project = await session.execute(
            select(ProjectDB).filter_by(id=invitation.project_id)
        )
        project = project.scalars().one_or_none()

        if not project:
            log.error(f"Project with ID {invitation.project_id} not found.")
            raise Exception(f"No project found with ID {invitation.project_id}")

        await session.delete(invitation)

        log.info(
            "[scopes] invitation deleted",
            organization_id=project.organization_id,
            workspace_id=project.workspace_id,
            project_id=invitation.project_id,
            user_id=invitation.user_id,
            membership_id=invitation.id,
        )

        await session.commit()

        return True


async def mark_invitation_as_used(
    project_id: str, user_id: str, invitation: InvitationDB
) -> bool:
    """
    Mark an invitation as used.

    Args:
        project_id (str): The ID of the project.
        user_id (str): the ID of the user.
        invitation (InvitationDB): The invitation to mark as used.

    Returns:
        bool: True if the invitation was successfully marked as used, False otherwise.

    Raises:
        HTTPException: If there is an error marking the invitation as used.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(
                project_id=uuid.UUID(project_id), token=invitation.token
            )
        )
        organization_invitation = result.scalars().first()
        if not organization_invitation:
            return False

        organization_invitation.used = True
        organization_invitation.user_id = uuid.UUID(user_id)

        await session.commit()
        return True


async def get_org_details(
    organization: Organization,
) -> dict:
    """
    Retrieve details of an organization.

    Args:
        organization (Organization): The organization to retrieve details for.

    Returns:
        dict: A dictionary containing the organization's details.
    """

    # Skip members for demo organizations to avoid returning thousands of users
    is_demo = organization.flags.get("is_demo", False) if organization.flags else False

    default_workspace_db = await get_org_default_workspace(organization)
    default_workspace = (
        await get_workspace_details(default_workspace_db, include_members=not is_demo)
        if default_workspace_db is not None
        else None
    )
    workspaces = await get_organization_workspaces(organization_id=str(organization.id))

    sample_organization = {
        "id": str(organization.id),
        "slug": organization.slug,
        "name": organization.name,
        "description": organization.description,
        "flags": organization.flags,
        "owner_id": str(organization.owner_id),
        "workspaces": [str(workspace.id) for workspace in workspaces],
        "default_workspace": default_workspace,
    }
    return sample_organization


async def get_workspace_details(
    workspace: WorkspaceDB, include_members: bool = True
) -> WorkspaceResponse:
    """
    Retrieve details of a workspace.

    Args:
        workspace (Workspace): The workspace to retrieve details for.
        include_members (bool): Whether to include workspace members. Defaults to True.

    Returns:
        dict: A dictionary containing the workspace's details.

    Raises:
        Exception: If there is an error retrieving the workspace details.
    """

    try:
        workspace_response = await get_workspace_in_format(
            workspace, include_members=include_members
        )
        return workspace_response
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise e


async def get_project_invitations(project_id: str, **kwargs):
    """
    Gets the project invitations.

    Args:
        project_id (str): The ID of the project
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        stmt = select(InvitationDB).filter(
            InvitationDB.project_id == uuid.UUID(project_id)
        )
        if kwargs.get("has_pending", False):
            stmt = stmt.filter(InvitationDB.used == kwargs["invitation_used"])

        result = await session.execute(stmt)
        invitations = result.scalars().all()
        return invitations


async def get_all_pending_invitations(email: str):
    """
    Gets all pending invitations for a given email.

    Args:
        email (str): The email address of the user.
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(InvitationDB).filter(
                InvitationDB.email == email,
                InvitationDB.used == False,  # noqa: E712
            )
        )
        invitations = result.scalars().all()
        return invitations


async def get_project_invitation(
    project_id: str, token: str, email: str
) -> InvitationDB:
    """Get project invitation by project ID, token and email.

    Args:
        project_id (str): The ID of the project.
        token (str): The invitation token.
        email (str): The email address of the invited user.

    Returns:
        InvitationDB: invitation object
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(
                project_id=uuid.UUID(project_id), token=token, email=email
            )
        )
        invitation = result.scalars().first()
        return invitation


async def create_org_workspace_invitation(
    workspace_role: str,
    token: str,
    email: str,
    project_id: str,
    expiration_date,
) -> InvitationDB:
    """
    Create an organization invitation.

    Args:
    - workspace_role (str): The role to assign the invited user in the project/workspace.
    - token (str): The token for the invitation.
    - email (str): The email address of the invited user.
    - expiration_date: The expiration date of the invitation.

    Returns:
    InvitationDB: The created invitation.

    """

    user = await db_manager.get_user_with_email(email=email)

    user_id = None
    if user:
        user_id = user.id

    project = await db_manager.fetch_project_by_id(
        project_id=project_id,
    )

    if not project:
        raise Exception(f"No project found with ID {project_id}")

    engine = get_transactions_engine()

    async with engine.session() as session:
        invitation = InvitationDB(
            token=token,
            email=email,
            project_id=uuid.UUID(project_id),
            expiration_date=expiration_date,
            role=workspace_role,
            used=False,
        )

        session.add(invitation)

        log.info(
            "[scopes] invitation created",
            organization_id=project.organization_id,
            workspace_id=project.workspace_id,
            project_id=project_id,
            user_id=user_id,
            invitation_id=invitation.id,
        )

        await session.commit()

        return invitation


async def get_all_workspace_roles() -> List[dict]:
    """Return the effective workspace role catalog.

    Resolved via access-controls (env-overridable via `AGENTA_ACCESS_ROLES`).
    Each entry is a dict with `role`, `description`, and `permissions`.
    """
    return get_roles("workspace")


# ---------------------------------------------------------------------------
# Platform Admin helpers
# ---------------------------------------------------------------------------


async def admin_delete_org_membership(membership_id: uuid.UUID) -> bool:
    """Delete an org membership by ID. Returns False if not found."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(OrganizationMemberDB).filter_by(id=membership_id)
        )
        membership = result.scalars().first()
        if not membership:
            return False
        await session.delete(membership)
        await session.commit()
        return True


async def admin_delete_workspace_membership(membership_id: uuid.UUID) -> bool:
    """Delete a workspace membership by ID. Returns False if not found."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(WorkspaceMemberDB).filter_by(id=membership_id)
        )
        membership = result.scalars().first()
        if not membership:
            return False
        await session.delete(membership)
        await session.commit()
        return True


async def admin_delete_project_membership(membership_id: uuid.UUID) -> bool:
    """Delete a project membership by ID. Returns False if not found."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(ProjectMemberDB).filter_by(id=membership_id)
        )
        membership = result.scalars().first()
        if not membership:
            return False
        await session.delete(membership)
        await session.commit()
        return True


async def admin_get_member_org_ids(
    user_id: uuid.UUID,
    org_ids: List[uuid.UUID],
) -> Set[uuid.UUID]:
    """Return the subset of org_ids where the user has a membership row."""
    engine = get_transactions_engine()

    async with engine.session() as session:
        rows = (
            (
                await session.execute(
                    select(OrganizationMemberDB.organization_id).where(
                        OrganizationMemberDB.user_id == user_id,
                        OrganizationMemberDB.organization_id.in_(org_ids),
                    )
                )
            )
            .scalars()
            .all()
        )
        return set(rows)


async def admin_swap_org_memberships(
    org_ids: List[uuid.UUID],
    source_id: uuid.UUID,
    target_id: uuid.UUID,
) -> None:
    """Swap org membership roles between source and target.

    Pre-condition: only acts on orgs where BOTH source and target already have
    a membership row.  For each qualifying org, target gets source's role and
    source gets target's prior role.
    """
    engine = get_transactions_engine()

    async with engine.session() as session:
        source_rows = (
            (
                await session.execute(
                    select(OrganizationMemberDB).where(
                        OrganizationMemberDB.user_id == source_id,
                        OrganizationMemberDB.organization_id.in_(org_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        target_rows = (
            (
                await session.execute(
                    select(OrganizationMemberDB).where(
                        OrganizationMemberDB.user_id == target_id,
                        OrganizationMemberDB.organization_id.in_(org_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        source_by_org = {row.organization_id: row.role for row in source_rows}
        target_by_org = {row.organization_id: row.role for row in target_rows}

        for org_id in set(source_by_org) & set(target_by_org):
            await session.execute(
                update(OrganizationMemberDB)
                .where(
                    OrganizationMemberDB.user_id == target_id,
                    OrganizationMemberDB.organization_id == org_id,
                )
                .values(role=source_by_org[org_id])
            )
            await session.execute(
                update(OrganizationMemberDB)
                .where(
                    OrganizationMemberDB.user_id == source_id,
                    OrganizationMemberDB.organization_id == org_id,
                )
                .values(role=target_by_org[org_id])
            )

        await session.commit()


async def admin_swap_workspace_memberships(
    workspace_ids: List[uuid.UUID],
    source_id: uuid.UUID,
    target_id: uuid.UUID,
) -> None:
    """Swap workspace membership roles between source and target.

    Pre-condition: only acts on workspaces where BOTH source and target already
    have a membership row.  For each qualifying workspace, target gets source's
    role and source gets target's prior role.
    """
    engine = get_transactions_engine()

    async with engine.session() as session:
        source_rows = (
            (
                await session.execute(
                    select(WorkspaceMemberDB).where(
                        WorkspaceMemberDB.user_id == source_id,
                        WorkspaceMemberDB.workspace_id.in_(workspace_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        target_rows = (
            (
                await session.execute(
                    select(WorkspaceMemberDB).where(
                        WorkspaceMemberDB.user_id == target_id,
                        WorkspaceMemberDB.workspace_id.in_(workspace_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        source_by_ws = {row.workspace_id: row.role for row in source_rows}
        target_by_ws = {row.workspace_id: row.role for row in target_rows}

        for ws_id in set(source_by_ws) & set(target_by_ws):
            await session.execute(
                update(WorkspaceMemberDB)
                .where(
                    WorkspaceMemberDB.user_id == target_id,
                    WorkspaceMemberDB.workspace_id == ws_id,
                )
                .values(role=source_by_ws[ws_id])
            )
            await session.execute(
                update(WorkspaceMemberDB)
                .where(
                    WorkspaceMemberDB.user_id == source_id,
                    WorkspaceMemberDB.workspace_id == ws_id,
                )
                .values(role=target_by_ws[ws_id])
            )

        await session.commit()


async def admin_swap_project_memberships(
    project_ids: List[uuid.UUID],
    source_id: uuid.UUID,
    target_id: uuid.UUID,
) -> None:
    """Swap project membership roles between source and target.

    Pre-condition: only acts on projects where BOTH source and target already
    have a membership row.  For each qualifying project, target gets source's
    role and source gets target's prior role.
    """
    engine = get_transactions_engine()

    async with engine.session() as session:
        source_rows = (
            (
                await session.execute(
                    select(ProjectMemberDB).where(
                        ProjectMemberDB.user_id == source_id,
                        ProjectMemberDB.project_id.in_(project_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        target_rows = (
            (
                await session.execute(
                    select(ProjectMemberDB).where(
                        ProjectMemberDB.user_id == target_id,
                        ProjectMemberDB.project_id.in_(project_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        source_by_proj = {row.project_id: row.role for row in source_rows}
        target_by_proj = {row.project_id: row.role for row in target_rows}

        for proj_id in set(source_by_proj) & set(target_by_proj):
            await session.execute(
                update(ProjectMemberDB)
                .where(
                    ProjectMemberDB.user_id == target_id,
                    ProjectMemberDB.project_id == proj_id,
                )
                .values(role=source_by_proj[proj_id])
            )
            await session.execute(
                update(ProjectMemberDB)
                .where(
                    ProjectMemberDB.user_id == source_id,
                    ProjectMemberDB.project_id == proj_id,
                )
                .values(role=target_by_proj[proj_id])
            )

        await session.commit()


async def admin_delete_user_memberships(user_id: uuid.UUID) -> None:
    """Delete all org/workspace/project memberships for a user.

    Called before hard-deleting a user so FK constraints are not violated.
    """
    engine = get_transactions_engine()

    async with engine.session() as session:
        await session.execute(
            delete(OrganizationMemberDB).where(OrganizationMemberDB.user_id == user_id)
        )
        await session.execute(
            delete(WorkspaceMemberDB).where(WorkspaceMemberDB.user_id == user_id)
        )
        await session.execute(
            delete(ProjectMemberDB).where(ProjectMemberDB.user_id == user_id)
        )
        await session.commit()


# Merged from ee/src/services/selectors.py
async def user_exists(user_email: str) -> bool:
    """Check if user exists in the database.

    Arguments:
        user_email (str): The email address of the logged-in user

    Returns:
        bool: confirming if the user exists or not.
    """

    user = await db_manager.get_user_with_email(email=user_email)
    return False if not user else True


async def get_org_default_workspace(organization: Organization) -> WorkspaceDB:
    """Get's the default workspace for an organization from the database.

    Arguments:
        organization (Organization): The organization

    Returns:
        WorkspaceDB: Instance of WorkspaceDB
    """

    engine = get_transactions_engine()

    async with engine.session() as session:
        result = await session.execute(
            select(WorkspaceDB).filter_by(
                organization_id=organization.id,
                type="default",
            )
        )
        workspace = result.scalars().first()
        if workspace is not None:
            return workspace

        result = await session.execute(
            select(WorkspaceDB).filter_by(
                organization_id=organization.id,
            )
        )
        return result.scalars().first()


# Merged from ee/src/services/converters.py
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
        project = await get_project_by_workspace(workspace_id=str(workspace.id))
        project_members = await get_project_members(project_id=str(project.id))
        invitations = await get_project_invitations(
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
