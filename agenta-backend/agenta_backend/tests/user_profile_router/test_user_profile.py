import pytest

from agenta_backend.models.db_models import UserDB
from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.api.user_models import User

import httpx


# Initialize database engine
engine = DBEngine().engine()

# Initialize http client
test_client = httpx.AsyncClient()
timeout = httpx.Timeout(timeout=5, read=None, write=5)

# Set global variables
BACKEND_API_HOST = "http://agenta-backend-1:8000"


@pytest.mark.asyncio
async def test_user_profile():
    user_db = await engine.find_one(UserDB, UserDB.uid == "0")
    user_db_dict = User(
        id=str(user_db.id),
        uid=str(user_db.uid),
        username=str(user_db.username),
        email=str(user_db.email),
    ).dict(exclude_unset=True)

    response = await test_client.get(f"{BACKEND_API_HOST}/profile/")

    assert response.status_code == 200
    assert response.json() == user_db_dict
