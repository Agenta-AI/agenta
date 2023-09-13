from typing import Tuple, Dict, List
from agenta_backend.services.db_manager import engine, UserDB


async def get_user_and_org_id(session) -> Dict[str, str]:
    """Retrieves the user ID and organization ID based on the logged-in session.

    Arguments:
        session (SessionContainer):  Used to store and manage the user's session data

    Returns:
        A dictionary containing the user_id and a list of the user's organization_ids.
    """
    return {"uid": "0", "organization_ids": []}


async def get_user_objectid(user_id: str) -> Tuple[str, List]:
    """Retrieves the user object ID and organization IDs from the database
    based on the user ID.

    Arguments:
        user_id (str): The unique identifier of a user

    Returns:
        a tuple containing the string representation of the user's ObjectId and the List
        of the user's organization_ids.
    """

    user = await engine.find_one(UserDB, UserDB.id == user_id)

    if user:
        user_id = str(user.id)
        organization_ids = (
            [str(org.id) for org in user.organizations] if user.organizations else []
        )
        return user_id, organization_ids

    return None, []
