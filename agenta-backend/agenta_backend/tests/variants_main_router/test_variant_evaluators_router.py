import os
import httpx
import pytest
import asyncio

from agenta_backend.models.api.evaluation_model import EvaluationStatusEnum
from agenta_backend.models.db_models import (
    AppDB,
    ConfigDB,
    TestSetDB,
    AppVariantDB,
    EvaluationDB,
    AppVariantDB,
    DeploymentDB,
    EvaluationScenarioDB,
)


# Initialize http client
test_client = httpx.AsyncClient()
timeout = httpx.Timeout(timeout=5, read=None, write=5)

# Set global variables
APP_NAME = "evaluation_in_backend"
ENVIRONMENT = os.environ.get("ENVIRONMENT")
OPEN_AI_KEY = os.environ.get("OPENAI_API_KEY")
if ENVIRONMENT == "development":
    BACKEND_API_HOST = "http://host.docker.internal/api"
elif ENVIRONMENT == "github":
    BACKEND_API_HOST = "http://agenta-backend-test:8000"


@pytest.mark.asyncio
async def test_create_app_from_template(
    app_from_template, fetch_user, fetch_single_prompt_template
):
    user = await fetch_user
    payload = app_from_template
    payload["app_name"] = APP_NAME
    payload["organization_id"] = str(user.organizations[0])
    payload["template_id"] = fetch_single_prompt_template["id"]

    response = httpx.post(
        f"{BACKEND_API_HOST}/apps/app_and_variant_from_template/", json=payload
    )
    assert response.status_code == 200


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
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    payload = auto_exact_match_evaluator_config
    payload["app_id"] = str(app.id)

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
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    payload = auto_similarity_match_evaluator_config
    payload["app_id"] = str(app.id)

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
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    payload = auto_regex_test_evaluator_config
    payload["app_id"] = str(app.id)
    payload["settings_values"]["regex_pattern"] = "^ig\\d{3}$"

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
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    payload = auto_webhook_test_evaluator_config
    payload["app_id"] = str(app.id)

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
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    payload = auto_ai_critique_evaluator_config
    payload["app_id"] = str(app.id)

    response = await test_client.post(
        f"{BACKEND_API_HOST}/evaluators/configs/", json=payload, timeout=timeout
    )
    assert response.status_code == 200
    assert response.json()["evaluator_key"] == payload["evaluator_key"]
    assert response.json()["settings_values"] == payload["settings_values"]


@pytest.mark.asyncio
async def test_get_evaluator_configs():
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    response = await test_client.get(
        f"{BACKEND_API_HOST}/evaluators/configs/?app_id={str(app.id)}",
        timeout=timeout,
    )
    assert response.status_code == 200
    assert type(response.json()) == list


@pytest.mark.asyncio
async def test_update_app_variant_parameters(update_app_variant_parameters):
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    testset = await TestSetDB.find_one(TestSetDB.app.id == app.id)
    app_variant = await AppVariantDB.find_one(
        AppVariantDB.app.id == app.id, AppVariantDB.variant_name == "app.default"
    )

    parameters = update_app_variant_parameters
    parameters["inputs"] = [{"name": list(testset.csvdata[0].keys())[0]}]
    payload = {"parameters": parameters}

    response = await test_client.put(
        f"{BACKEND_API_HOST}/variants/{str(app_variant.id)}/parameters/", json=payload
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_create_evaluation():
    # Fetch app, app_variant and testset
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    app_variant = await AppVariantDB.find_one(AppVariantDB.app.id == app.id)
    testset = await TestSetDB.find_one(TestSetDB.app.id == app.id)

    # Prepare payload
    payload = {
        "app_id": str(app.id),
        "variant_ids": [str(app_variant.id)],
        "evaluators_configs": [],
        "testset_id": str(testset.id),
        "lm_providers_keys": {"openai": OPEN_AI_KEY},
        "rate_limit": {
            "batch_size": 10,
            "max_retries": 3,
            "retry_delay": 3,
            "delay_between_batches": 5,
        },
    }

    # Fetch evaluator configs
    response = await test_client.get(
        f"{BACKEND_API_HOST}/evaluators/configs/?app_id={payload['app_id']}",
        timeout=timeout,
    )
    list_of_configs_ids = []
    evaluator_configs = response.json()
    for evaluator_config in evaluator_configs:
        list_of_configs_ids.append(evaluator_config["id"])

    # Update payload with list of configs ids
    payload["evaluators_configs"] = list_of_configs_ids

    # Make request to create evaluation
    response = await test_client.post(
        f"{BACKEND_API_HOST}/evaluations/", json=payload, timeout=timeout
    )
    response_data = response.json()[0]

    assert response.status_code == 200
    assert response_data["app_id"] == payload["app_id"]
    assert response_data["status"] == EvaluationStatusEnum.EVALUATION_STARTED
    assert response_data is not None


# TODO (@aybruhm): will uncomment when ai critique evaluator issue is resolved
# @pytest.mark.asyncio
# async def test_fetch_evaluation_status():
#     evaluations = (
#         await EvaluationDB.find().to_list()
#     )  # will return only one in this case
#     evaluation = evaluations[0]

#     # Prepare and start short-polling request
#     max_attempts = 10
#     intervals = 4  # seconds
#     for _ in range(max_attempts):
#         response = await test_client.get(
#             f"{BACKEND_API_HOST}/evaluations/{str(evaluation.id)}/status/",
#             timeout=timeout,
#         )
#         response_data = response.json()
#         if response_data["status"] == EvaluationStatusEnum.EVALUATION_FINISHED:
#             assert True
#             return
#         await asyncio.sleep(intervals)

#     assert (
#         False
#     ), f"Evaluation status did not become '{EvaluationStatusEnum.EVALUATION_FINISHED}' within the specified polling time"


# @pytest.mark.asyncio
# async def test_fetch_evaluation_results():
#     evaluations = (
#         await EvaluationDB.find().to_list()
#     )  # will return only one in this case
#     evaluation = evaluations[0]

#     response = await test_client.get(
#         f"{BACKEND_API_HOST}/evaluations/{str(evaluation.id)}/results/", timeout=timeout
#     )
#     response_data = response.json()

#     assert response.status_code == 200
#     assert response_data["evaluation_id"] == str(evaluation.id)
#     assert len(response_data["results"]) == 5


@pytest.mark.asyncio
async def test_delete_evaluator_config():
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    response = await test_client.get(
        f"{BACKEND_API_HOST}/evaluators/configs/?app_id={str(app.id)}",
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


# @pytest.mark.asyncio
# async def test_evaluation_scenario_match_evaluation_testset_length():
#     evaluations = await EvaluationDB.find(
#         fetch_links=True
#     ).to_list()  # will return only one in this case
#     evaluation = evaluations[0]
#     evaluation_scenario_count = await EvaluationScenarioDB.find(
#         EvaluationScenarioDB.evaluation.id == evaluation.id
#     ).count()

#     assert evaluation_scenario_count == len(evaluation.testset.csvdata)


@pytest.mark.asyncio
async def test_remove_running_template_app_container():
    import docker

    # Connect to the Docker daemon
    client = docker.from_env()
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    deployment = await DeploymentDB.find_one(DeploymentDB.app.id == app.id)
    try:
        # Retrieve container
        container = client.containers.get(deployment.container_name)
        # Stop and remove container
        container.stop()
        container.remove()
        assert True
    except:
        assert False
