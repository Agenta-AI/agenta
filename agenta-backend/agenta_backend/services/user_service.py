from typing import Dict
from agenta_backend.services.db_mongo import users
from agenta_backend.models.api.user_models import User, UserUpdate


async def create_new_user(payload: User) -> Dict:
    user = await users.insert_one(payload.dict())
    return user


async def update_user(user_id: str, payload: UserUpdate) -> Dict:
    user = await users.find_one({"id": user_id})
    if user is not None:
        values_to_update = {key: value for key, value in payload.dict()}
        updated_user = await users.update_one(
            {"id": user_id}, {"$set": values_to_update}
        )
        return updated_user
    raise NotFound("Credentials not found. Please try again!")


class NotFound(Exception):
    """Custom exception for credentials not found"""

    pass
