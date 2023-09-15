from agenta_backend.services.db_manager import engine, UserDB
from agenta_backend.models.api.user_models import User, UserUpdate
from agenta_backend.services.organization_service import get_organization


async def create_new_user(payload: User) -> UserDB:
    user_instance = UserDB(
        uid=payload.uid,
        username=payload.username,
        email=payload.email,
    )
    user = await engine.save(user_instance)
    return user


async def update_user(user_uid: str, payload: UserUpdate) -> UserDB:
    user = await engine.find_one(UserDB, UserDB.uid == user_uid)

    if user is not None:
        values_to_update = {key: value for key, value in payload.dict()}
        updated_user = user.update(values_to_update)
        await engine.save(updated_user)
        return user
    raise NotFound("Credentials not found. Please try again!")


class NotFound(Exception):
    """Custom exception for credentials not found"""

    pass
