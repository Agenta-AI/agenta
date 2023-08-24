from typing import Tuple, Dict, Union
from agenta_backend.services.db_mongo import users
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.recipe.thirdpartypasswordless.asyncio import get_user_by_id


async def get_user_and_org_id(session: SessionContainer) -> Dict[str, str]:
    """Retrieves the user ID and organization ID based on the logged-in session.

    Arguments:
        session (SessionContainer):  Used to store and manage the user's session data

    Returns:
        A dictionary containing the user_id and organization_id.
    """

    user_session_id = session.get_user_id()
    user_info = await get_user_by_id(user_session_id)
    user_id, org_id = await get_user_objectid(user_info.email)
    return {"user_id": user_id, "organization_id": org_id}


async def get_user_objectid(
    user_email: str,
) -> Union[Tuple[str, str], Tuple[None, None]]:
    """Retrieves the user object ID and organization ID from the database
    based on the user ID.

    Arguments:
        user_email (str): The email address of the logged-in user

    Returns:
        a tuple containing the string representation of the user's ObjectId and the string
    representation of the user's organization_id.
    """

    user = await users.find_one({"email": user_email})
    if user:
        return str(user["id"]), str(user["organization_id"])
    return None, None


async def user_exists(user_email: str) -> bool:
    """Check if user exists in the database.

    Arguments:
        user_email (str): The email address of the logged-in user

    Returns:
        bool: confirming if the user exists or not.
    """

    user = await users.find_one({"email": user_email})
    return False if user is None else True
