from __future__ import annotations

import uuid
import string
import secrets
import hashlib
from typing import List, Union
from datetime import datetime, timezone

from sqlalchemy.future import select
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import joinedload

from oss.src.utils.logging import get_module_logger
from oss.src.models.db_models import APIKeyDB, UserDB
from oss.src.dbs.postgres.shared.engine import engine

# from oss.src.utils.redis_utils import redis_connection

log = get_module_logger(__name__)


async def _generate_unique_prefix():
    """
    Generates a unique 8-character prefix by randomly selecting characters from a predefined alphabet and checking if the prefix is already present in the database.

    Returns:
        str: The generated unique 8-character prefix.

    Example Usage:
        # Initialize the APIKeyManager class object
        api_key_manager = APIKeyManager()

        # Call the generate_unique_prefix method
        prefix = await api_key_manager.generate_unique_prefix()
    """

    # Define the characters to use for the prefix
    alphabet = string.ascii_letters + string.digits

    async with engine.core_session() as session:
        while True:
            # Generate a random 8-character prefix
            prefix = "".join(secrets.choice(alphabet) for _ in range(8))

            # Check if the prefix is unique in the database
            result = await session.execute(select(APIKeyDB).filter_by(prefix=prefix))
            existing_key = result.scalars().first()
            if not existing_key:
                return prefix


async def create_api_key(
    user_id: str, project_id: str, expiration_date=None, hidden=False
):
    """
    Generates a unique API key with a prefix for user display.

    Args:
        user_id (str): The ID of the user for whom the API key is being created.
        project_Id (str): The ID of the project.
        rate_limit (int, optional): The maximum number of requests allowed per minute for the API key. Defaults to 1000.
        expiration_date (datetime, optional): The date and time when the API key will expire. Defaults to None.
        hidden: hidden api keys are used when starting llm apps from the backend. They are not shown in the UI and are not rate limited

    Returns:
        str: The raw API key with the prefix for user display.
    """

    # Generate a unique 8-character prefix
    prefix = await _generate_unique_prefix()

    # Generate a cryptographically secure random API key
    raw_api_key = secrets.token_hex(32)  # 32 bytes of randomness

    # Hash the API key
    hashed_api_key = hashlib.sha256(raw_api_key.encode()).hexdigest()

    # Add the prefix to the hashed API key
    prefix_hashed_api_key = f"{prefix}.{hashed_api_key}"

    # get rate limit from env
    rate_limit = 0

    async with engine.core_session() as session:
        # Create an APIKeyDB instance with the prefix, hashed API key, and user_id
        api_key = APIKeyDB(
            prefix=prefix,
            hashed_key=prefix_hashed_api_key,
            created_by_id=uuid.UUID(user_id),
            project_id=uuid.UUID(project_id),
            rate_limit=max(0, rate_limit),
            expiration_date=expiration_date if expiration_date else None,
            hidden=bool(hidden),
            created_at=datetime.now(timezone.utc),
        )

        session.add(api_key)
        await session.commit()

    raw_api_key_with_prefix = f"{prefix}.{raw_api_key}"

    # Return the raw API key (only once) for user display
    return raw_api_key_with_prefix


async def is_valid_api_key(key: str):
    """
    Checks if an API key is valid by verifying that it is not blacklisted and not expired.

    Args:
    - key: The API key to be checked.

    Returns:
    - The API Key object if the API key is valid, False otherwise.
    """

    async with engine.core_session() as session:
        # Check if the API key is valid (not blacklisted and not expired)
        result = await session.execute(
            select(APIKeyDB)
            .options(joinedload(APIKeyDB.user).load_only(UserDB.id, UserDB.email))
            .filter_by(hashed_key=key)
        )

        api_key = result.scalars().first()
        if not api_key:
            return False

        if (
            api_key.expiration_date is not None
            and api_key.expiration_date < datetime.now(timezone.utc)
        ):
            return False

        return api_key


# async def check_rate_limit(api_key_obj: APIKeyDB, cache_key: str):
#     """
#     Checks if an API key has exceeded its rate limit.

#     Args:
#     - key: The API key to be checked.

#     Returns:
#     - True if the API key has exceeded its rate limit, False otherwise.
#     """

#     if api_key_obj.rate_limit > 0:
#         # Check rate limiting in Redis
#         r = redis_connection()
#         if r is not None:
#             api_requests_within_minute = r.get(cache_key)
#             if api_requests_within_minute is None:
#                 # Initialize the count in Redis with an initial value of 1 and a one-minute TTL
#                 r.setex(cache_key, 60, 1)
#             else:
#                 # Check if requests made within the last minute exceed the rate limit
#                 count_within_minute = int(api_requests_within_minute.decode("utf-8"))
#                 if count_within_minute > api_key_obj.rate_limit:
#                     return True

#         # increment the apikey usage count in redis
#         r.incr(cache_key)

#     return False


async def use_api_key(key: str) -> Union[APIKeyDB, bool]:
    """
    Validates and checks the rate limit of an API key.

    Args:
        key (str): The API key to be used and validated.

    Returns:
        [APIKeyDB, bool]: The API key object if the API key is valid, False if the API key is invalid.

    Raises:
        HTTPException: If there is an error using the API key.

    Example Usage:
    ```python
        # Initialize the APIKeyManager class object
        api_key_manager = APIKeyManager()

        # Call the use_api_key method
        result = await api_key_manager.use_api_key(api_key)

        # Check the result
        if result:
            # API key is valid
            pass
        else:
            # API key is invalid
            pass
    ```
    """

    try:
        # Extract the prefix and raw API key
        bearer_prefix, raw_api_key = key.split(".", 1)

        # Retrieve the prefix of the api key from the bearer_prefix (Bearer xxxxxx)
        prefix = (
            bearer_prefix.split(" ")[-1] if "Bearer" in bearer_prefix else bearer_prefix
        )

    except ValueError:
        return False

    # Hash the raw API key
    hashed_api_key = hashlib.sha256(raw_api_key.encode()).hexdigest()

    # Add the prefix to the hashed API key
    prefixed_hashed_api_key = f"{prefix}.{hashed_api_key}"

    # Use the API key and check rate limiting
    api_key = await is_valid_api_key(key=prefixed_hashed_api_key)

    return False if not api_key else api_key


async def list_api_keys(user_id: str, project_id: str) -> List[APIKeyDB]:
    """
    Lists all API keys associated with a user.

    Args:
        user_id (str): The ID of the user.
        project_id (str): The ID of the project.

    Returns:
        List[APIKeyDB]: A list of APIKeyDB objects associated with the user, sorted by most recently created first.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(APIKeyDB)
            .filter_by(
                created_by_id=uuid.UUID(user_id),
                project_id=uuid.UUID(project_id),
                hidden=False,
            )
            .order_by(APIKeyDB.created_at.desc())
        )
        api_keys = result.scalars().all()
        return api_keys


async def delete_api_key(user_id: str, key_prefix: str):
    """
    Deletes an API key associated with a user.

    Args:
        user_id (str): The ID of the user.
        key (str): The API key to be deleted.

    Raises:
        KeyError: If the API key does not exist or does not belong to the user.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(APIKeyDB).filter_by(
                created_by_id=uuid.UUID(user_id), prefix=key_prefix
            )
        )
        existing_key = result.scalars().first()
        if not existing_key:
            raise NoResultFound("API key not found or does not belong to the user.")

        await session.delete(existing_key)
        await session.commit()
