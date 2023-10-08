import pytest
import aiofiles
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
BACKEND_API_HOST = "http://localhost:8000"
TESTSET_SUBMODULE_DIR = Path(__file__).parent


# @pytest.mark.asyncio
# async def test_csv_upload_file():
#     app = await engine.find_one(AppDB, AppDB.app_name == "test_app")

#     payload = {
#         "testset_name": "variant_testset_csv_upload",
#         "app_id": str(app.id),
#     }
#     files = {
#         "file": (
#             "test_countries.csv",
#             open(f"{TESTSET_SUBMODULE_DIR}/test_countries_testset.csv", "rb"),
#         ),
#         "content_type": "text/csv",
#     }
#     response = await test_client.post(
#         f"{BACKEND_API_HOST}/testsets/upload",
#         json=payload,
#         files=files,
#     )

#     print("Response: ", response.status_code)

#     # assert response.status_code == 200
#     assert response.json()["name"] == payload["testset_name"]


# @pytest.mark.asyncio
# async def test_json_upload_file():
#     app = await engine.find_one(AppDB, AppDB.app_name == "test_app")

#     payload = {
#         "testset_name": "variant_testset_json_upload",
#         "upload_type": "JSON",
#         "app_id": str(app.id),
#     }

#     files = {
#         "file": (
#             "test_countries.json",
#             open(f"{TESTSET_SUBMODULE_DIR}/test_countries_testset.json", "rb"),
#         ),
#         "content_type": "application/json",
#     }
#     response = await test_client.post(
#         f"{BACKEND_API_HOST}/testsets/upload",
#         json=payload,
#         files=files,
#     )

#     # assert response.status_code == 200
#     print("Response: ", response.json())

#     assert response.json()["name"] == payload["testset_name"]


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
