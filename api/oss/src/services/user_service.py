import uuid

from sqlalchemy.future import select
from sqlalchemy.exc import NoResultFound

from oss.src.utils.common import isCloud

if isCloud():
    from ee.src.models.db_models import UserDB_ as UserDB
else:
    from oss.src.models.db_models import UserDB

from oss.src.models.api.user_models import UserUpdate

from oss.src.dbs.postgres.shared.engine import engine


async def create_new_user(payload: dict) -> UserDB:
    """
    This function creates a new user.

    Args:
        payload (dict): The payload data to create the user.

    Returns:
        UserDB: The created user object.
    """

    async with engine.session() as session:
        user = UserDB(**payload)

        session.add(user)
        await session.commit()
        await session.refresh(user)

        return user


async def update_user(user_uid: str, payload: UserUpdate) -> UserDB:
    """
    This function updates the user.

    Args:
        user_uid (str): The supertokens session id of the user
        payload (UserUpdate): The payload to update the user information with

    Returns:
        UserDB: The updated user object

    Raises:
        NoResultFound: User with session id xxxx not found.
    """

    async with engine.session() as session:
        result = await session.execute(select(UserDB).filter_by(uid=user_uid))
        user = result.scalars().first()

        if not user:
            raise NoResultFound(f"User with session id {user_uid} not found.")

        for key, value in payload.dict(exclude_unset=True):
            if hasattr(user, key):
                setattr(user, key, value)

        await session.commit()
        await session.refresh(user)

        return user
