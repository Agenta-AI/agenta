import os
import httpx
import pytest
import asyncio

from sqlalchemy.future import select
from sqlalchemy.orm import joinedload

from oss.src.models.api.evaluation_model import EvaluationStatusEnum
from oss.src.models.db_models import (
    AppDB,
    TestsetDB,
    AppVariantDB,
    EvaluationDB,
    EvaluationScenarioDB,
)

from oss.src.dbs.postgres.shared.engine import engine


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
async def test_get_evaluators_endpoint():
    response = await test_client.get(
        f"{BACKEND_API_HOST}/evaluators/",
        timeout=timeout,
    )
    assert response.status_code == 200
    assert len(response.json()) > 0


@pytest.mark.asyncio
async def test_create_auto_exact_match_evaluator_config(
    auto_exact_match_evaluator_config,
):
    async with engine.core_session() as session:
        result = await session.execute(select(AppDB).filter_by(app_name=APP_NAME))
        app = result.scalars().first()

        payload = auto_exact_match_evaluator_config
        payload["app_id"] = str(app.id)
        payload["settings_values"]["correct_answer_key"] = "correct_answer"

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
    async with engine.core_session() as session:
        result = await session.execute(select(AppDB).filter_by(app_name=APP_NAME))
        app = result.scalars().first()

        payload = auto_similarity_match_evaluator_config
        payload["app_id"] = str(app.id)
        payload["settings_values"]["correct_answer_key"] = "correct_answer"

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
    async with engine.core_session() as session:
        result = await session.execute(select(AppDB).filter_by(app_name=APP_NAME))
        app = result.scalars().first()

        payload = auto_regex_test_evaluator_config
        payload["app_id"] = str(app.id)
        payload["settings_values"]["regex_pattern"] = "^ig\\d{3}$"
        payload["settings_values"]["correct_answer_key"] = "correct_answer"

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
    async with engine.core_session() as session:
        result = await session.execute(select(AppDB).filter_by(app_name=APP_NAME))
        app = result.scalars().first()

        payload = auto_webhook_test_evaluator_config
        payload["app_id"] = str(app.id)
        payload["settings_values"]["correct_answer_key"] = "correct_answer"

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
    async with engine.core_session() as session:
        result = await session.execute(select(AppDB).filter_by(app_name=APP_NAME))
        app = result.scalars().first()

        payload = auto_ai_critique_evaluator_config
        payload["app_id"] = str(app.id)
        payload["settings_values"]["correct_answer_key"] = "correct_answer"

        response = await test_client.post(
            f"{BACKEND_API_HOST}/evaluators/configs/", json=payload, timeout=timeout
        )
        assert response.status_code == 200
        assert response.json()["evaluator_key"] == payload["evaluator_key"]
        assert response.json()["settings_values"] == payload["settings_values"]


@pytest.mark.asyncio
async def test_get_evaluator_configs():
    async with engine.core_session() as session:
        result = await session.execute(select(AppDB).filter_by(app_name=APP_NAME))
        app = result.scalars().first()

        response = await test_client.get(
            f"{BACKEND_API_HOST}/evaluators/configs/?app_id={str(app.id)}",
            timeout=timeout,
        )
        assert response.status_code == 200
        assert type(response.json()) == list  # noqa: E721


async def fetch_evaluation_results(evaluation_id):
    response = await test_client.get(
        f"{BACKEND_API_HOST}/evaluations/{evaluation_id}/results/", timeout=timeout
    )
    response_data = response.json()

    assert response.status_code == 200
    assert response_data["evaluation_id"] == evaluation_id


async def wait_for_evaluation_to_finish(evaluation_id):
    max_attempts = 12
    intervals = 5  # seconds
    for _ in range(max_attempts):
        response = await test_client.get(
            f"{BACKEND_API_HOST}/evaluations/{evaluation_id}/status/",
            timeout=timeout,
        )
        response_data = response.json()
        if response_data["status"]["value"] == EvaluationStatusEnum.EVALUATION_FINISHED:
            await fetch_evaluation_results(evaluation_id)
            assert True
            return
        await asyncio.sleep(intervals)

    assert False, (
        f"Evaluation status did not become '{EvaluationStatusEnum.EVALUATION_FINISHED}' within the specified polling time"
    )


async def create_evaluation_with_evaluator(evaluator_config_name):
    # Fetch app, app_variant and testset
    async with engine.core_session() as session:
        app_result = await session.execute(select(AppDB).filter_by(app_name=APP_NAME))
        app = app_result.scalars().first()

        app_variant_result = await session.execute(
            select(AppVariantDB).filter_by(app_id=app.id)
        )
        app_variant = app_variant_result.scalars().first()

        testset_result = await session.execute(
            select(TestsetDB).filter_by(project_id=app.project_id)
        )
        testset = testset_result.scalars().first()

        # Prepare payload
        payload = {
            "app_id": str(app.id),
            "variant_ids": [str(app_variant.id)],
            "evaluators_configs": [],
            "testset_id": str(testset.id),
            "lm_providers_keys": {"OPENAI_API_KEY": OPEN_AI_KEY},
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
            if evaluator_config["evaluator_key"] == evaluator_config_name:
                list_of_configs_ids.append(evaluator_config["id"])

        # Update payload with list of configs ids
        payload["evaluators_configs"] = list_of_configs_ids

        # Sleep for 10 seconds (to allow the llm app to start completely)
        await asyncio.sleep(10)

        # Make request to create evaluation
        response = await test_client.post(
            f"{BACKEND_API_HOST}/evaluations/", json=payload, timeout=timeout
        )
        response_data = response.json()[0]

        assert response.status_code == 200
        assert response_data["app_id"] == payload["app_id"]
        assert (
            response_data["status"]["value"]
            == EvaluationStatusEnum.EVALUATION_INITIALIZED.value
        )
        assert response_data is not None

        # Wait for evaluation to finish
        evaluation_id = response_data["id"]
        await wait_for_evaluation_to_finish(evaluation_id)


# @pytest.mark.asyncio
# async def test_create_evaluation_with_no_llm_keys(evaluators_requiring_llm_keys):
#     async with engine.core_session() as session:
#         app_result = await session.execute(select(AppDB).filter_by(app_name=APP_NAME))
#         app = app_result.scalars().first()

#         app_variant_result = await session.execute(
#             select(AppVariantDB).filter_by(app_id=app.id)
#         )
#         app_variant = app_variant_result.scalars().first()

#         testset_result = await session.execute(
#             select(TestsetDB).filter_by(project_id=app.project_id)
#         )
#         testset = testset_result.scalars().first()

#         # Prepare payload
#         payload = {
#             "app_id": str(app.id),
#             "variant_ids": [str(app_variant.id)],
#             "evaluators_configs": [],
#             "testset_id": str(testset.id),
#             "lm_providers_keys": {"MISTRAL_API_KEY": OPEN_AI_KEY},
#             "rate_limit": {
#                 "batch_size": 10,
#                 "max_retries": 3,
#                 "retry_delay": 3,
#                 "delay_between_batches": 5,
#             },
#         }

#         # Fetch evaluator configs
#         response = await test_client.get(
#             f"{BACKEND_API_HOST}/evaluators/configs/?app_id={payload['app_id']}",
#             timeout=timeout,
#         )
#         list_of_configs_ids = []
#         evaluator_configs = response.json()
#         for evaluator_config in evaluator_configs:
#             if evaluator_config["evaluator_key"] in evaluators_requiring_llm_keys:
#                 list_of_configs_ids.append(evaluator_config["id"])

#         # Update payload with list of configs ids
#         payload["evaluators_configs"] = list_of_configs_ids

#         # Make request to create evaluation
#         response = await test_client.post(
#             f"{BACKEND_API_HOST}/evaluations/", json=payload, timeout=timeout
#         )

#         assert response.status_code == 500
#         assert (
#             response.json()["detail"]
#             == "OpenAI API key is required to run one or more of the specified evaluators."
#         )


@pytest.mark.asyncio
async def test_create_evaluation_auto_exact_match():
    await create_evaluation_with_evaluator("auto_exact_match_evaluator_config")


@pytest.mark.asyncio
async def test_create_evaluation_auto_similarity_match():
    await create_evaluation_with_evaluator("auto_similarity_match_evaluator_config")


@pytest.mark.asyncio
async def test_create_evaluation_auto_regex_test():
    await create_evaluation_with_evaluator("auto_regex_test_evaluator_config")


@pytest.mark.asyncio
async def test_create_evaluation_auto_webhook_test():
    await create_evaluation_with_evaluator("auto_webhook_test_evaluator_config")


@pytest.mark.asyncio
async def test_create_evaluation_auto_ai_critique():
    await create_evaluation_with_evaluator("auto_ai_critique_evaluator_config")


@pytest.mark.asyncio
async def test_delete_evaluator_config():
    async with engine.core_session() as session:
        result = await session.execute(select(AppDB).filter_by(app_name=APP_NAME))
        app = result.scalars().first()

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


@pytest.mark.asyncio
async def test_evaluation_scenario_match_evaluation_testset_length():
    async with engine.core_session() as session:
        result = await session.execute(
            select(EvaluationDB).options(joinedload(EvaluationDB.testset))
        )
        evaluations = result.scalars().all()

        evaluation = evaluations[0]
        evaluation_scenarios_result = await session.execute(
            select(EvaluationScenarioDB).filter_by(evaluation_id=evaluation.id)
        )
        evaluation_scenarios = evaluation_scenarios_result.scalars().all()

        assert len(evaluation_scenarios) == len(evaluation.testset.csvdata)


@pytest.mark.asyncio
async def test_rag_experiment_tree_maps_correctly(
    rag_experiment_data_tree, mapper_to_run_rag_faithfulness_evaluation
):
    payload = {
        "inputs": rag_experiment_data_tree,
        "mapping": mapper_to_run_rag_faithfulness_evaluation,
    }
    response = await test_client.post(
        f"{BACKEND_API_HOST}/evaluators/map",
        json=payload,
        timeout=timeout,
    )
    response_data = response.json()
    assert response.status_code == 200
    assert (
        "question" in response_data["outputs"]
        and "contexts" in response_data["outputs"]
        and "answer" in response_data["outputs"]
    )


@pytest.mark.asyncio
async def test_simple_experiment_tree_maps_correctly(
    simple_experiment_data_tree, mapper_to_run_auto_exact_match_evaluation
):
    payload = {
        "inputs": simple_experiment_data_tree,
        "mapping": mapper_to_run_auto_exact_match_evaluation,
    }
    response = await test_client.post(
        f"{BACKEND_API_HOST}/evaluators/map",
        json=payload,
        timeout=timeout,
    )
    response_data = response.json()
    assert response.status_code == 200
    assert "prediction" in response_data["outputs"] and isinstance(
        response_data["outputs"]["prediction"], str
    )


@pytest.mark.asyncio
async def test_rag_faithfulness_evaluator_run(
    rag_faithfulness_evaluator_run_inputs,
):
    payload = {
        "inputs": rag_faithfulness_evaluator_run_inputs,
        "credentials": {"OPENAI_API_KEY": os.environ["OPENAI_API_KEY"]},
    }
    response = await test_client.post(
        f"{BACKEND_API_HOST}/evaluators/rag_faithfulness/run",
        json=payload,
        timeout=timeout,
    )
    assert response.status_code == 200
    assert 0.0 <= response.json()["outputs"]["score"] <= 1.0
    assert isinstance(response.json()["outputs"]["score"], float)


@pytest.mark.asyncio
async def test_custom_code_evaluator_run(custom_code_snippet):
    payload = {
        "inputs": {
            "ground_truth": "The correct answer is 42",
            "prediction": "The answer is 42",
            "app_config": {},
        },
        "settings": {
            "code": custom_code_snippet,
            "correct_answer_key": "correct_answer",
        },
    }
    response = await test_client.post(
        f"{BACKEND_API_HOST}/evaluators/auto_custom_code_run/run",
        json=payload,
        timeout=timeout,
    )
    assert response.status_code == 200
    assert 0.0 <= response.json()["outputs"]["score"] <= 1.0
    assert isinstance(response.json()["outputs"]["score"], float)


@pytest.mark.asyncio
async def test_run_evaluators_via_api(
    evaluators_payload_data,
):
    evaluators_response_status_code = []
    for evaluator_key, evaluator_payload in evaluators_payload_data.items():
        response = await test_client.post(
            f"{BACKEND_API_HOST}/evaluators/{evaluator_key}/run",
            json=evaluator_payload,
            timeout=timeout,
        )
        evaluators_response_status_code.append(response.status_code)

    assert evaluators_response_status_code.count(200) == 14
