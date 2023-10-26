import pytest

from agenta_backend.services import selectors
from agenta_backend.models.db_models import UserDB
from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.api.organization_models import OrganizationOutput

import httpx


# Initialize database engine
engine = DBEngine().engine()

# Initialize http client
test_client = httpx.AsyncClient()
timeout = httpx.Timeout(timeout=5, read=None, write=5)

# Set global variables
BACKEND_API_HOST = "http://localhost:8001"


@pytest.mark.asyncio
async def test_list_organizations():
    response = await test_client.get(f"{BACKEND_API_HOST}/organizations/")

    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_get_user_organization():
    user = await engine.find_one(UserDB, UserDB.uid == "0")
    user_org = await selectors.get_user_own_org(user.uid)

    response = await test_client.get(f"{BACKEND_API_HOST}/organizations/own/")

    assert response.status_code == 200
    assert response.json() == OrganizationOutput(
        id=str(user_org.id), name=user_org.name
    )


@pytest.mark.asyncio
async def test_user_does_not_have_an_organization():
    user = UserDB(uid="0123", username="john_doe", email="johndoe@email.com")
    await engine.save(user)

    user_org = await selectors.get_user_own_org(user.uid)
    assert user_org == None
