import pytest
import asyncio
from bson import ObjectId
from datetime import datetime

from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.db_models import (
    UserDB,
    OrganizationDB,
)

# Initialize database engine
engine = DBEngine().engine()


@pytest.fixture(scope="function")
async def get_first_user_object():
    """Get the user object from the database or create a new one if not found."""

    try:
        user = await engine.find_one(UserDB, UserDB.uid == "0")
        if user is None:
            create_user = UserDB(uid="0")
            await engine.save(create_user)

            org = OrganizationDB(type="default", owner=str(create_user.id))
            await engine.save(org)

            create_user.organizations.append(org.id)
            await engine.save(create_user)
            await engine.save(org)

            return create_user
        else:
            return user
    except Exception as e:
        pytest.fail(f"Failed to get or create the first user: {e}")
