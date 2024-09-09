import os
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.future import select

from agenta_backend.models.db_models import UserDB
from agenta_backend.models.db.postgres_engine import db_engine
from agenta_backend.models.api.user_models import User


# Initialize http client
test_client = httpx.AsyncClient()
timeout = httpx.Timeout(timeout=5, read=None, write=5)

# Set global variables
ENVIRONMENT = os.environ.get("ENVIRONMENT")
if ENVIRONMENT == "development":
    BACKEND_API_HOST = "http://host.docker.internal/api"
elif ENVIRONMENT == "github":
    BACKEND_API_HOST = "http://agenta-backend-test:8000"


@pytest.mark.asyncio
async def test_fetch_user_profile_without_user_id():
    async with db_engine.get_session() as session:
        result = await session.execute(select(UserDB).filter_by(uid="0"))
        user_db = result.scalars().first()
        if not user_db:
            assert False

        user_db_dict = User(
            id=str(user_db.id),
            uid=str(user_db.uid),
            username=str(user_db.username),
            email=str(user_db.email),
            created_at=str(user_db.created_at),
            updated_at=str(user_db.updated_at),
        ).model_dump(exclude_unset=True)

        response = await test_client.get(f"{BACKEND_API_HOST}/profile/")

        assert response.status_code == 200
        assert response.json()["id"] == user_db_dict["id"]
        assert response.json()["uid"] == user_db_dict["uid"]
        assert response.json()["email"] == user_db_dict["email"]
        assert response.json()["username"] == user_db_dict["username"]


async def test_fetch_user_profile_with_valid_user_id():
    async with db_engine.get_session() as session:
        result = await session.execute(select(UserDB).filter_by(uid="0"))
        user_db = result.scalars().first()
        if not user_db:
            assert False

        user_db_dict = User(
            id=str(user_db.id),
            uid=str(user_db.uid),
            username=str(user_db.username),
            email=str(user_db.email),
            created_at=str(user_db.created_at),
            updated_at=str(user_db.updated_at),
        ).model_dump(exclude_unset=True)

        response = await test_client.get(
            f"{BACKEND_API_HOST}/profile/?user_id={str(user_db.id)}"
        )

        assert response.status_code == 200
        assert response.json()["id"] == user_db_dict["id"]
        assert response.json()["uid"] == user_db_dict["uid"]
        assert response.json()["email"] == user_db_dict["email"]
        assert response.json()["username"] == user_db_dict["username"]


async def test_fetch_user_profile_with_non_existent_user_id_error():
    user_non_existent_id = str(uuid4())
    response = await test_client.get(
        f"{BACKEND_API_HOST}/profile/?user_id={user_non_existent_id}"
    )

    assert response.status_code == 500
    assert response.json()["detail"] == f"User with id {user_non_existent_id} not found"
