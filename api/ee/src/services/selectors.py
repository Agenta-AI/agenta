from typing import Dict, List, Union

from sqlalchemy.future import select
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import load_only, joinedload

from oss.src.services import db_manager
from oss.src.utils.logging import get_module_logger

from oss.src.dbs.postgres.shared.engine import engine
from ee.src.models.api.organization_models import Organization
from ee.src.models.db_models import (
    WorkspaceDB,
    OrganizationDB,
    WorkspaceMemberDB,
    OrganizationMemberDB,
)

log = get_module_logger(__name__)


async def get_user_org_and_workspace_id(user_uid) -> Dict[str, Union[str, List[str]]]:
    """
    Retrieves the user ID and organization IDs associated with a given user UID.

    Args:
        user_uid (str): The UID of the user.

    Returns:
        dict: A dictionary containing the user UID, ID, list of workspace IDS and list of organization IDS associated with a user.
              If the user is not found, returns None

    Example Usage:
        result = await get_user_org_and_workspace_id("user123")
        print(result)

    Output:
        { "id": "123", "uid": "user123", "organization_ids": [], "workspace_ids": []}
    """

    user = await db_manager.get_user_with_id(user_id=user_uid)

    if not user:
        raise NoResultFound(f"User with uid {user_uid} not found")

    async with engine.core_connection() as connection:
        stmt = (
            select(OrganizationMemberDB)
            .filter_by(
                user_id=user.id,
            )
            .options(
                load_only(OrganizationMemberDB.organization_id),
            )  # type: ignore
        )

        user_org_result = await connection.execute(stmt=stmt, prepare=True)

        orgs = user_org_result.scalars().all()

        organization_ids = [str(user_org.organization_id) for user_org in orgs]

        stmt = (
            select(WorkspaceMemberDB)
            .filter_by(
                user_id=user.id,
            )
            .options(
                load_only(WorkspaceMemberDB.workspace_id),
            )  # type: ignore
        )

        member_in_workspaces_result = await connection.execute(stmt=stmt, prepare=True)

        workspaces_ids = [
            str(user_workspace.workspace_id)
            for user_workspace in member_in_workspaces_result.scalars().all()
        ]

        return {
            "id": str(user.id),
            "uid": str(user.uid),
            "workspace_ids": workspaces_ids,
            "organization_ids": organization_ids,
        }


async def user_exists(user_email: str) -> bool:
    """Check if user exists in the database.

    Arguments:
        user_email (str): The email address of the logged-in user

    Returns:
        bool: confirming if the user exists or not.
    """

    user = await db_manager.get_user_with_email(email=user_email)
    return False if not user else True


async def get_user_own_org(user_uid: str) -> OrganizationDB:
    """Get's the default users' organization from the database.

    Arguments:
        user_uid (str): The uid of the user

    Returns:
        Organization: Instance of OrganizationDB
    """

    user = await db_manager.get_user_with_id(user_id=user_uid)

    async with engine.core_connection() as connection:
        stmt = select(OrganizationDB).filter_by(
            owner=str(user.id),
            type="default",
        )

        org_query = await connection.execute(stmt=stmt, prepare=True)

        org = org_query.scalars().first()

        return org


async def get_org_default_workspace(organization: Organization) -> WorkspaceDB:
    """Get's the default workspace for an organization from the database.

    Arguments:
        organization (Organization): The organization

    Returns:
        WorkspaceDB: Instance of WorkspaceDB
    """

    async with engine.core_connection() as connection:
        stmt = (
            select(WorkspaceDB)
            .filter_by(
                organization_id=organization.id,
                type="default",
            )
            .options(
                joinedload(WorkspaceDB.members),
            )
        )

        result = await connection.execute(stmt=stmt, prepare=True)

        workspace = result.scalars().first()

        return workspace
