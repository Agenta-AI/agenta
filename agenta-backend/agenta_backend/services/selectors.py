from bson import ObjectId
from typing import Tuple, Dict
from agenta_backend.services.db_mongo import users
from supertokens_python.recipe.session import SessionContainer


async def get_user_and_org_id(session: SessionContainer) -> Dict[str, str]:
    """Retrieves the user ID and organization ID based on the logged-in session.

    Arguments:
        session (SessionContainer):  Used to store and manage the user's session data

    Returns:
        A dictionary containing the user_id and organization_id.
    """

    user_session_id = session.get_user_id()
    user_id, org_id = await get_user_objectid(user_session_id)
    return {"user_id": user_id, "organization_id": org_id}


async def get_user_objectid(user_id: str) -> Tuple[str, str]:
    """Retrieves the user object ID and organization ID from the database
    based on the user ID.

    Arguments:
        user_id (str): The unique identifier of a user

    Returns:
        a tuple containing the string representation of the user's ObjectId and the string
    representation of the user's organization_id.
    """

    user = await users.find_one({"_id": ObjectId(user_id)})
    return str(user["_id"]), str(user["organization_id"])
