import os
from agenta_backend.utils.common import isCloud

if isCloud():
    from agenta_backend.commons.models.db_models import UserDB_ as UserDB
else:
    from agenta_backend.models.db_models import UserDB
from agenta_backend.models.api.user_models import User, UserUpdate


async def create_new_user(payload: User) -> UserDB:
    user_instance = UserDB(
        uid=payload.uid,
        username=payload.username,
        email=payload.email,
    )
    user = await user_instance.create()
    return user


async def update_user(user_uid: str, payload: UserUpdate) -> UserDB:
    user = await UserDB.find_one(UserDB.uid == user_uid, fetch_links=True)

    if user is not None:
        values_to_update = {key: value for key, value in payload.dict()}
        await user.update({"$set": values_to_update})
        return user
    raise NotFound("Credentials not found. Please try again!")


class NotFound(Exception):
    """Custom exception for credentials not found"""

    pass
