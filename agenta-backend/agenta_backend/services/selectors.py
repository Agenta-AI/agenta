from typing import Tuple, Dict, List

from agenta_backend.models.db_models import (
    UserDB,
    OrganizationDB,
    WorkspaceDB,
)


async def get_user_and_org_id(user_uid_id) -> Dict[str, List]:
    """Retrieves the user ID and organization ID based on the logged-in session.

    Arguments:
        session (SessionContainer):  Used to store and manage the user's session data

    Returns:
        A dictionary containing the user_id and a list of the user's organization_ids.
    """
    user, org_ids = await get_user_objectid(user_uid_id)
    return {"uid": str(user.uid), "id": str(user.id), "organization_ids": org_ids}


async def get_user_objectid(user_uid: str) -> Tuple[str, List]:
    """Retrieves the user object ID and organization IDs from the database
    based on the user ID.

    Arguments:
        user_id (str): The unique identifier of a user

    Returns:
        a tuple containing the string representation of the user's ObjectId and the List
        of the user's organization_ids.
    """

    user = await UserDB.find_one(UserDB.uid == user_uid)
    if user is not None:
        organization_ids: List = (
            [org for org in user.organizations] if user.organizations else []
        )
        return user, organization_ids
    return None, []


async def get_user_own_org(user_uid: str) -> OrganizationDB:
    """Get's the default users' organization from the database.

    Arguments:
        user_uid (str): The uid of the user

    Returns:
        Organization: Instance of OrganizationDB
    """

    user = await UserDB.find_one(UserDB.uid == user_uid)
    org: OrganizationDB = await OrganizationDB.find_one(
        OrganizationDB.owner == str(user.id), OrganizationDB.type == "default"
    )
    if org is not None:
        return org
    else:
        return None


async def get_org_default_workspace(organization: OrganizationDB) -> WorkspaceDB:
    """Get's the default workspace for an organization from the database.

    Arguments:
        organization (OrganizationDB): The organization

    Returns:
        WorkspaceDB: Instance of WorkspaceDB
    """

    workspace: WorkspaceDB = await WorkspaceDB.find_one(
        WorkspaceDB.organization == organization.id, WorkspaceDB.type == "default"
    )
    return workspace
    
