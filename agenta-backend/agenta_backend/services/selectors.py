from typing import Tuple, Dict
from agenta_backend.services.db_mongo import users
from agenta_backend.services.commoners import create_accounts

from supertokens_python.recipe.session import SessionContainer
from supertokens_python.recipe.thirdpartypasswordless.asyncio import (
    get_user_by_id,
)


async def get_user_and_org_id(session: SessionContainer) -> Dict[str, str]:
    """Retrieves the user ID and organization ID based on the logged-in session.

    Arguments:
        session (SessionContainer):  Used to store and manage the user's session data

    Returns:
        A dictionary containing the user_id and organization_id.
    """

    user_session_id = session.get_user_id()
    user_info = await get_user_by_id(user_session_id)
    user_id, org_id = await get_user_objectid(
        {"user_id": user_session_id, "user_email": user_info.email}
    )
    return {"user_id": user_id, "organization_id": org_id}


async def get_user_objectid(payload: dict) -> Tuple[str, str]:
    """Retrieves the user object ID and organization ID from the database
    based on the user ID.

    Arguments:
        payload (dict): The required payload. It consists of; user_id and user_email

    Returns:
        a tuple containing the string representation of the user's ObjectId and the string
    representation of the user's organization_id.
    """

    user = await users.find_one({"email": payload["user_email"]})
    if user is None:
        user_id, org_id = await create_accounts(payload)
        return user_id, org_id
    return str(user["id"]), str(user["organization_id"])
