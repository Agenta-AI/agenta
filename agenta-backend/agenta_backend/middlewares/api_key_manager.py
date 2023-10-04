import os
import redis
import logging
from datetime import datetime
from cryptography.fernet import Fernet
from fastapi import Request, HTTPException
from agenta_backend.config import settings
from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.db_models import APIKeyDB

engine = DBEngine().engine()

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

encryption_key = os.environ["ENCRYPTION_KEY"]
fernet = Fernet(encryption_key)



class APIKeyManager:
    """
    A class that manages API keys.

    Methods:
    - create_api_key(user_id, rate_limit, expiration_date=None): Creates a new API key with an encrypted user ID, rate limit, and optional expiration date.
    - update_api_key(key, api_key): Updates an existing API key with the provided key and APIKeyDB instance.
    - delete_api_key(key): Deletes an API key with the provided key.
    - is_valid_api_key(key): Checks if an API key is valid by verifying that it is not blacklisted and not expired.
    - use_api_key(key): Uses an API key and checks rate limiting.
    """

    def __init__(self):
        self.redis_client = redis.from_url(url=settings.redis_url)  

    def create_api_key(self, user_id, rate_limit, expiration_date=None):
        """
        Creates a new API key with an encrypted user ID, rate limit, and optional expiration date.

        Args:
        - user_id: The user ID to be encrypted and used as the API key.
        - rate_limit: The rate limit for the API key.
        - expiration_date: Optional expiration date for the API key.

        Raises:
        - ValueError: If a unique key cannot be generated after 5 trials.
        """
        for _ in range(5):
            # Encrypt the user_id using Fernet encryption
            encrypted_user_id = fernet.encrypt(user_id.encode())

            # Check if an API key with the same key exists
            existing_key = engine.find_one(APIKeyDB, APIKeyDB.key == encrypted_user_id)

            if not existing_key:
                # Create an APIKeyDB instance with the encrypted user_id as the key
                api_key = APIKeyDB(
                    key=encrypted_user_id,
                    rate_limit=rate_limit,
                    expiration_date=expiration_date,
                )

                # Store the API key in the database
                engine.save(api_key)
                return encrypted_user_id

        # If after 5 trials, a unique key is not generated, raise an error
        raise ValueError("Unable to generate a unique API key")

    def update_api_key(self, key, api_key):
        """
        Updates an existing API key with the provided key and APIKeyDB instance.

        Args:
        - key: The key of the API key to be updated.
        - api_key: The updated APIKeyDB instance.

        Raises:
        - KeyError: If the API key does not exist.
        """
        # Check if the API key exists
        existing_key = engine.find_one(APIKeyDB, APIKeyDB.key == key)
        if not existing_key:
            raise KeyError("API key not found")

        # Update the API key
        engine.save(api_key)

    def delete_api_key(self, key):
        """
        Deletes an API key with the provided key.

        Args:
        - key: The key of the API key to be deleted.

        Raises:
        - KeyError: If the API key does not exist.
        """
        # Check if the API key exists
        existing_key = engine.find_one(APIKeyDB, APIKeyDB.key == key)
        if not existing_key:
            raise KeyError("API key not found")

        # Delete the API key
        engine.delete(existing_key)

    def is_valid_api_key(self, key):
        """
        Checks if an API key is valid by verifying that it is not blacklisted and not expired.

        Args:
        - key: The API key to be checked.

        Returns:
        - True if the API key is valid, False otherwise.
        """
        # Check if the API key is valid (not blacklisted and not expired)
        api_key = engine.find_one(APIKeyDB, APIKeyDB.key == key)
        if not api_key:
            return False

        if api_key.blacklist:
            return False

        if api_key.expiration_date and api_key.expiration_date < datetime.utcnow():
            return False

        return api_key

    async def use_api_key(self, key):
        """
        Uses an API key and checks rate limiting.

        Args:
        - key: The API key to be used.

        Returns:
        - True if the API key can be used, False otherwise.
        """
        # Use the API key and check rate limiting
        api_key = self.is_valid_api_key(key)
        if not api_key:
            raise ValueError("Invalid API key, make sure it exists, is not blacklisted or expired")

        try:
            if api_key.rate_limit > 0:

                # Check rate limiting in Redis
                if self.redis_client is None:
                    await self.init_redis()

                cache_key = f"api_request_count:{key}"
                api_requests_within_minute = await self.redis_client.get(cache_key)

                if api_requests_within_minute is None:
                    # Initialize the count in Redis with an initial value of 1 and a one-minute TTL
                    await self.redis_client.setex(cache_key, 60, 1)
                else:

                    # Check if requests made within the last minute exceed the rate limit
                    count_within_minute = int(api_requests_within_minute)
                    if count_within_minute > api_key.rate_limit:
                        raise ValueError("API key rate limit exceeded")

            # Update the last usage timestamp for rate limiting
            api_key.updated_at = datetime.utcnow()
            engine.save(api_key)

            return True
        except Exception as e:
            logger.error(f"Error using API key: {e}")
            raise e


async def authenticate_middleware(request: Request, call_next):
    """
    Middleware function responsible for authenticating API requests.

    Args:
        request (Request): The incoming HTTP request object.
        call_next: The function to call to proceed to the next middleware or route handler.

    Raises:
        HTTPException: If the request does not contain a valid API key in the Authorization header.

    Returns:
        The response from the next middleware or route handler.
    """

    authorization_key = request.headers.get("Authorization")
    if not authorization_key:
        raise HTTPException(status_code=401, detail="API Key is missing")

    # Validate the API key using the APIKeyManager
    try:
        APIKeyManager.use_api_key(authorization_key)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception:
        raise HTTPException(status_code=403, detail="Couldn't validate API Key")

    # Decrypt the API key using the decrypt_api_key function
    decrypted_user_id = decrypt_api_key(authorization_key)
    if not decrypted_user_id:
        raise HTTPException(status_code=403, detail="Invalid API Key")

    # Store the decrypted API key in the request state for later use
    request.state.user_id = decrypted_user_id

    response = await call_next(request)
    return response


def decrypt_api_key(authorization_key: str) -> str:
    """
    Decrypts the authorization key and returns the decrypted user ID.

    Args:
        authorization_key (str): The encrypted authorization key that needs to be decrypted.

    Returns:
        str: The decrypted user ID extracted from the authorization key.
    """
    try:    
        decrypted_user_id = fernet.decrypt(authorization_key.encode()).decode()

        return decrypted_user_id
    except Exception as e:
        logger.error(f"Error decrypting API key: {e}")