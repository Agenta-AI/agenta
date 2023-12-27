import httpx
import pytest
import asyncio

from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.db_models import EvaluationDB
from agenta_backend.models.api.evaluation_model import Evaluation, EvaluationStatusEnum


# Initialize database engine
engine = DBEngine().engine()

# Initialize http client
test_client = httpx.AsyncClient()
timeout = httpx.Timeout(timeout=5, read=None, write=5)

# Set global variables
BACKEND_API_HOST = "http://host.docker.internal/api"


@pytest.mark.asyncio
async def test_get_evaluators_endpoint():
    response = await test_client.get(
        f"{BACKEND_API_HOST}/evaluators/",
        timeout=timeout,
    )
    assert response.status_code == 200
    assert len(response.json()) == 8  # currently we have 8 evaluators


@pytest.mark.asyncio
async def test_create_auto_exact_match_evaluator_config(
    auto_exact_match_evaluator_config,
):
    payload = await auto_exact_match_evaluator_config
    response = await test_client.post(
        f"{BACKEND_API_HOST}/evaluators/configs/", json=payload, timeout=timeout
    )
    assert response.status_code == 200
    assert response.json()["evaluator_key"] == payload["evaluator_key"]
    assert response.json()["settings_values"] == payload["settings_values"]


@pytest.mark.asyncio
async def test_create_auto_similarity_match_evaluator_config(
    auto_similarity_match_evaluator_config,
):
    payload = await auto_similarity_match_evaluator_config
    response = await test_client.post(
        f"{BACKEND_API_HOST}/evaluators/configs/", json=payload, timeout=timeout
    )
    assert response.status_code == 200
    assert response.json()["evaluator_key"] == payload["evaluator_key"]
    assert response.json()["settings_values"] == payload["settings_values"]


@pytest.mark.asyncio
async def test_create_auto_regex_test_evaluator_config(
    auto_regex_test_evaluator_config,
):
    payload = await auto_regex_test_evaluator_config
    payload["settings_values"]["regex_pattern"] = "^Nigeria\\d{3}$"
    response = await test_client.post(
        f"{BACKEND_API_HOST}/evaluators/configs/", json=payload, timeout=timeout
    )
    assert response.status_code == 200
    assert response.json()["evaluator_key"] == payload["evaluator_key"]
    assert response.json()["settings_values"] == payload["settings_values"]


@pytest.mark.asyncio
async def test_create_auto_webhook_test_evaluator_config(
    auto_webhook_test_evaluator_config,
):
    payload = await auto_webhook_test_evaluator_config
    response = await test_client.post(
        f"{BACKEND_API_HOST}/evaluators/configs/", json=payload, timeout=timeout
    )
    assert response.status_code == 200
    assert response.json()["evaluator_key"] == payload["evaluator_key"]
    assert response.json()["settings_values"] == payload["settings_values"]


@pytest.mark.asyncio
async def test_create_auto_ai_critique_evaluator_config(
    auto_ai_critique_evaluator_config,
):
    payload = await auto_ai_critique_evaluator_config
    response = await test_client.post(
        f"{BACKEND_API_HOST}/evaluators/configs/", json=payload, timeout=timeout
    )
    assert response.status_code == 200
    assert response.json()["evaluator_key"] == payload["evaluator_key"]
    assert response.json()["settings_values"] == payload["settings_values"]


@pytest.mark.asyncio
async def test_get_evaluator_configs(fetch_app):
    app = await fetch_app
    response = await test_client.get(
        f"{BACKEND_API_HOST}/evaluators/configs/?app_id={app['app_id']}",
        timeout=timeout,
    )
    assert response.status_code == 200
    assert type(response.json()) == list


@pytest.mark.asyncio
async def test_create_evaluation(prepare_testset_csvdata):
    # Fetch app variant and testset
    testset = await prepare_testset_csvdata

    # Prepare payload
    payload = {
        "app_id": testset["app_id"],
        "variant_ids": [
            testset["variant_id"],
        ],
        "evaluators_configs": [],
        "testset_id": ""
    }

    # Fetch evaluator configs
    response = await test_client.get(
        f"{BACKEND_API_HOST}/evaluators/configs/?app_id={testset['app_id']}",
        timeout=timeout,
    )
    list_of_configs_ids = []
    evaluator_configs = response.json()
    for evaluator_config in evaluator_configs:
        list_of_configs_ids.append(evaluator_config["id"])

    # Update payload with list of configs ids and testset id
    payload["evaluators_configs"] = list_of_configs_ids
    payload["testset_id"] = testset["testset_id"]

    # Make request to create evaluation
    response = await test_client.post(
        f"{BACKEND_API_HOST}/evaluations/", json=payload, timeout=timeout
    )
    response_data = response.json()

    assert response.status_code == 200
    assert response_data["app_id"] == payload["app_id"]
    assert response_data["status"] == EvaluationStatusEnum.EVALUATION_STARTED
    assert response_data is not None and isinstance(response_data, Evaluation)


@pytest.mark.asyncio
async def test_fetch_evaluation_status():
    evaluations = await engine.find(EvaluationDB)  # will return only one in this case
    evaluation = evaluations[0]

    # Prepare short-polling request
    max_attempts = 10
    intervals = 2  # seconds
    for _ in range(max_attempts):
        response = await test_client.get(
            f"{BACKEND_API_HOST}/evaluations/{str(evaluation.id)}/status/",
            timeout=timeout,
        )
        response_data = response.json()
        if response_data["status"] == EvaluationStatusEnum.EVALUATION_FINISHED:
            assert True
            return
        await asyncio.sleep(intervals)

    assert (
        False
    ), f"Evaluation status did not become '{EvaluationStatusEnum.EVALUATION_FINISHED}' within the specified polling time"


@pytest.mark.asyncio
async def test_fetch_evaluation_results():
    evaluations = await engine.find(EvaluationDB)  # will return only one in this case
    evaluation = evaluations[0]

    response = await test_client.get(
        f"{BACKEND_API_HOST}/evaluations/{str(evaluation.id)}/results/", timeout=timeout
    )
    response_data = response.json()

    assert response.status_code == 200
    assert response_data["evaluation_id"] == str(evaluation.id)
    assert len(response_data["results"]) == 5


@pytest.mark.asyncio
async def test_delete_evaluator_config(fetch_app):
    app = await fetch_app
    response = await test_client.get(
        f"{BACKEND_API_HOST}/evaluators/configs/?app_id={app['app_id']}",
        timeout=timeout,
    )
    list_of_deleted_configs = []
    evaluator_configs = response.json()
    for evaluator_config in evaluator_configs:
        response = await test_client.delete(
            f"{BACKEND_API_HOST}/evaluators/configs/{str(evaluator_config['id'])}/",
            timeout=timeout,
        )
        list_of_deleted_configs.append(response.json())

    count_of_deleted_configs = sum(list_of_deleted_configs)
    assert len(evaluator_configs) == count_of_deleted_configs
