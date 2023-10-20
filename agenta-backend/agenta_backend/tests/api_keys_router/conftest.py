import uuid
import pytest
import logging

from agenta_backend.models.db_engine import DBEngine
from agenta_backend.ee.services.auth_helper import APIKeyManager

api_key_manager = APIKeyManager()

from agenta_backend.models.db_models import (
    UserDB,
    APIKeyDB,
    OrganizationDB,
)

# Initialize database engine
engine = DBEngine().engine()

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@pytest.fixture(scope="function")
async def get_first_user_and_apikey():
    """
    Get the api_key object from the database or create a new one if not found.
    """

    try:
        user = await engine.find_one(UserDB, UserDB.uid == "0")
        if user is None:
            user = UserDB(uid="0")
            await engine.save(user)

            org = OrganizationDB(type="default", owner=str(user.id))
            await engine.save(org)

            user.organizations.append(org.id)
            await engine.save(user)
            await engine.save(org)

        user_api_key = await api_key_manager.create_api_key(user.uid)
        return user, user_api_key

    except Exception as e:
        pytest.fail(f"Failed to get or create the first user: {e}")
