import os
from pathlib import Path

from agenta_backend.models.db_models import (
    AppDB,
    TestSetDB,
)
import httpx

import pytest


# Initialize http client
test_client = httpx.AsyncClient()
timeout = httpx.Timeout(timeout=5, read=None, write=5)

# Set global variables
ENVIRONMENT = os.environ.get("ENVIRONMENT")
if ENVIRONMENT == "development":
    BACKEND_API_HOST = "http://host.docker.internal/api"
elif ENVIRONMENT == "github":
    BACKEND_API_HOST = "http://agenta-backend-test:8000"


# TODO: test_csv_upload_file
# TODO: test_json_upload_file


@pytest.mark.asyncio
async def test_create_testset():
    app = await AppDB.find_one(AppDB.app_name == "app_variant_test")

    payload = {
        "name": "create_testset_main",
        "csvdata": [
            {
                "country": "Comoros",
                "correct_answer": "The capital of Comoros is Moroni",
            },
            {
                "country": "Kyrgyzstan",
                "correct_answer": "The capital of Kyrgyzstan is Bishkek",
            },
            {
                "country": "Azerbaijan",
                "correct_answer": "The capital of Azerbaijan is Baku",
            },
        ],
    }
    response = await test_client.post(
        f"{BACKEND_API_HOST}/testsets/{str(app.id)}/", json=payload
    )
    assert response.status_code == 200
    assert response.json()["name"] == payload["name"]


@pytest.mark.asyncio
async def test_update_testset():
    app = await AppDB.find_one(AppDB.app_name == "app_variant_test")
    testset = await TestSetDB.find_one(TestSetDB.app.id == app.id)

    payload = {
        "name": "update_testset",
        "csvdata": [
            {
                "country": "Comoros",
                "correct_answer": "The capital of Comoros is Moroni",
            },
            {
                "country": "Kyrgyzstan",
                "correct_answer": "The capital of Kyrgyzstan is Bishkek",
            },
            {
                "country": "Azerbaijan",
                "correct_answer": "The capital of Azerbaijan is Baku",
            },
        ],
    }
    response = await test_client.put(
        f"{BACKEND_API_HOST}/testsets/{str(testset.id)}/", json=payload
    )

    assert response.status_code == 200
    assert response.json()["_id"] == str(testset.id)
    assert response.json()["status"] == "success"
    assert response.json()["message"] == "testset updated successfully"


@pytest.mark.asyncio
async def test_get_testsets():
    app = await AppDB.find_one(AppDB.app_name == "app_variant_test")
    response = await test_client.get(
        f"{BACKEND_API_HOST}/testsets/?app_id={str(app.id)}"
    )

    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio()
async def test_get_testset():
    app = await AppDB.find_one(AppDB.app_name == "app_variant_test")
    testset = await TestSetDB.find_one(TestSetDB.app.id == app.id)

    response = await test_client.get(f"{BACKEND_API_HOST}/testsets/{str(testset.id)}/")

    assert response.status_code == 200
    assert response.json()["name"] == testset.name
    assert response.json()["id"] == str(testset.id)


@pytest.mark.asyncio
async def test_delete_testsets():
    app = await AppDB.find_one(AppDB.app_name == "app_variant_test")
    testsets = await TestSetDB.find(TestSetDB.app.id == app.id).to_list()

    testset_ids = [str(testset.id) for testset in testsets]
    payload = {"testset_ids": testset_ids}

    response = await test_client.request(
        method="DELETE", url=f"{BACKEND_API_HOST}/testsets/", json=payload
    )

    assert response.status_code == 200
    assert response.json() == testset_ids
