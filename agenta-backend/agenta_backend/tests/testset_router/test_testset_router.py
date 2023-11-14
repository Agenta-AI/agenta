import pytest
from pathlib import Path

from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.db_models import (
    AppDB,
    TestSetDB,
)

import httpx


# Initialize database engine
engine = DBEngine().engine()

# Initialize http client
test_client = httpx.AsyncClient()
timeout = httpx.Timeout(timeout=5, read=None, write=5)

# Set global variables
BACKEND_API_HOST = "http://localhost:8001"
TESTSET_SUBMODULE_DIR = Path(__file__).parent


@pytest.mark.asyncio
async def test_csv_upload_file():
    app = await engine.find_one(AppDB, AppDB.app_name == "test_app")

    # CSV Payload
    csv_payload = {
        "name": "csv_testset",
        "csvdata": [
            {"country": "Canada", "correct_answer": "Ottawa"},
            {"country": "Germany", "correct_answer": "Berlin"},
        ],
    }

    response = await test_client.post(
        f"{BACKEND_API_HOST}/testsets/{str(app.id)}/", json=csv_payload
    )

    assert response.status_code == 200
    assert response.json()["name"] == csv_payload["name"]


@pytest.mark.asyncio
async def test_json_upload_file():
    app = await engine.find_one(AppDB, AppDB.app_name == "test_app")

    # JSON Payload
    json_payload = {
        "name": "json_testset",
        "jsondata": [
            {"country": "France", "correct_answer": "Paris"},
            {"country": "Japan", "correct_answer": "Tokyo"},
        ],
    }

    response = await test_client.post(
        f"{BACKEND_API_HOST}/testsets/{str(app.id)}/", json=json_payload
    )

    assert response.status_code == 200
    assert response.json()["name"] == json_payload["name"]


@pytest.mark.asyncio
async def test_create_testset():
    app = await engine.find_one(AppDB, AppDB.app_name == "test_app")

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
    app = await engine.find_one(AppDB, AppDB.app_name == "test_app")
    testset = await engine.find_one(TestSetDB, TestSetDB.app == app.id)

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
    app = await engine.find_one(AppDB, AppDB.app_name == "test_app")
    response = await test_client.get(
        f"{BACKEND_API_HOST}/testsets/?app_id={str(app.id)}"
    )

    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio()
async def test_get_testset():
    app = await engine.find_one(AppDB, AppDB.app_name == "test_app")
    testset = await engine.find_one(TestSetDB, TestSetDB.app == app.id)

    response = await test_client.get(f"{BACKEND_API_HOST}/testsets/{str(testset.id)}/")

    assert response.status_code == 200
    assert response.json()["name"] == testset.name
    assert response.json()["id"] == str(testset.id)


@pytest.mark.asyncio
async def test_delete_testsets():
    app = await engine.find_one(AppDB, AppDB.app_name == "test_app")
    testsets = await engine.find(TestSetDB, TestSetDB.app == app.id)

    testset_ids = [str(testset.id) for testset in testsets]
    payload = {"testset_ids": testset_ids}

    response = await test_client.request(
        method="DELETE", url=f"{BACKEND_API_HOST}/testsets/", json=payload
    )

    assert response.status_code == 200
    assert response.json() == testset_ids
