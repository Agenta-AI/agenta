from typing import Tuple, Dict, List
from agenta_backend.services.db_mongo import users


async def get_user_and_org_id(session) -> Dict[str, str]:
    """Retrieves the user ID and organization ID based on the logged-in session.

    Arguments:
        session (SessionContainer):  Used to store and manage the user's session data

    Returns:
        A dictionary containing the user_id and organization_id.
    """
    return {"uid": "0", "organization_id": "0"}


async def get_user_objectid(user_id: str) -> Tuple[str, List]:
    """Retrieves the user object ID and organization ID from the database
    based on the user ID.

    Arguments:
        user_id (str): The unique identifier of a user

    Returns:
        a tuple containing the string representation of the user's ObjectId and the string
    representation of the user's organization_id.
    """

    user = await users.find_one({"id": user_id})

    if user:
        user_id = str(user["id"])
        organization_ids = [str(org.id) for org in user.organizations] if user.organizations else []
        return user_id, organization_ids
    return None, None
