import os
import httpx
import pytest
from pathlib import Path
from bson import ObjectId
from datetime import datetime

from agenta_backend.models.db_engine import DBEngine
from agenta_backend.services.json_importer_helper import get_json
from agenta_backend.models.db_models import (
    AppDB,
    AppVariantDB,
    OrganizationDB,
    TestSetDB,
)


# Initialize database engine
engine = DBEngine().engine()

# Set global variables
BASE_URI = "http://host.docker.internal/"
BACKEND_URI = BASE_URI + "api/"
PARENT_DIRECTORY = Path(os.path.dirname(__file__)).parent.parent
OPEN_AI_KEY = "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"


@pytest.fixture(scope="session")
def fetch_templates():
    response = httpx.get(f"{BACKEND_URI}containers/templates/")
    response_data = response.json()
    return response_data


@pytest.fixture(scope="session")
def use_open_ai_key():
    return OPEN_AI_KEY


@pytest.fixture(scope="session")
def fetch_single_prompt_template(fetch_templates):
    return fetch_templates[1]


@pytest.fixture(scope="session")
def ensure_frontend_reachable():
    response = httpx.get(f"{BASE_URI}apps/")
    response.raise_for_status()
    return response.text


@pytest.fixture()
async def fetch_app():
    apps = await engine.find(AppDB)
    return {
        "app_id": str(apps[0].id),
        "app_name": apps[0].app_name,
        "org_id": str(apps[0].user.organizations[0]),
    }


@pytest.fixture()
async def fetch_app_variant(fetch_app):
    app = await fetch_app
    app_variant = await engine.find_one(
        AppVariantDB, AppVariantDB.app == ObjectId(app["app_id"])
    )
    return {"variant_id": str(app_variant.id), "app_id": app["app_id"]}


@pytest.fixture()
async def create_app_from_template(fetch_app, fetch_single_prompt_template):
    app = await fetch_app
    payload = {
        "app_name": app["app_name"],
        "template_id": fetch_single_prompt_template["id"],
        "env_vars": {"OPENAI_API_KEY": OPEN_AI_KEY},
        "organization_id": app["org_id"],
    }
    print("Payload: ", payload)
    response = httpx.post(
        f"{BACKEND_URI}apps/app_and_variant_from_template/", json=payload
    )
    return response.json()


@pytest.fixture()
async def prepare_testset_csvdata(create_app_from_template):
    app_variant = await create_app_from_template
    print("AppV: ", app_variant)
    app_db = await engine.find_one(AppDB, AppDB.id == ObjectId(app_variant["app_id"]))
    org_db = await engine.find_one(
        OrganizationDB, OrganizationDB.id == ObjectId(app_variant["organization_id"])
    )
    json_path = os.path.join(
        PARENT_DIRECTORY,
        "resources",
        "default_testsets",
        "chat_openai_testset.json",
    )

    csvdata = get_json(json_path)
    testset = {
        "name": f"{app_db.app_name}_testset",
        "app_name": app_db.app_name,
        "created_at": datetime.now().isoformat(),
        "csvdata": csvdata,
    }
    testset_db = TestSetDB(**testset, app=app_db, user=app_db.user, organization=org_db)
    await engine.save(testset_db)
    return {
        "testset_id": str(testset_db.id),
        "variant_id": app_variant["variant_id"],
        "app_id": app_variant["app_id"],
    }


@pytest.fixture()
async def auto_exact_match_evaluator_config(fetch_app):
    app = await fetch_app
    return {
        "app_id": app["app_id"],
        "name": "ExactMatchEvaluator",
        "evaluator_key": "auto_exact_match",
        "settings_values": {},
    }


@pytest.fixture()
async def auto_similarity_match_evaluator_config(fetch_app):
    app = await fetch_app
    return {
        "app_id": app["app_id"],
        "name": "SimilarityMatchEvaluator",
        "evaluator_key": "auto_similarity_match",
        "settings_values": {"similarity_threshold": 0.3},
    }


@pytest.fixture()
async def auto_regex_test_evaluator_config(fetch_app):
    app = await fetch_app
    return {
        "app_id": app["app_id"],
        "name": "RegexEvaluator",
        "evaluator_key": "auto_regex_test",
        "settings_values": {
            "regex_pattern": "^value\\d{3}$",
            "regex_should_match": False,
        },
    }


@pytest.fixture()
async def auto_webhook_test_evaluator_config(fetch_app):
    app = await fetch_app
    return {
        "app_id": app["app_id"],
        "name": "WebhookEvaluator",
        "evaluator_key": "auto_webhook_test",
        "settings_values": {
            "webhook_url": f"{BACKEND_URI}evaluations/webhook_example_fake/",
            "webhook_body": {},
        },
    }


@pytest.fixture()
async def auto_ai_critique_evaluator_config(fetch_app):
    app = await fetch_app
    return {
        "app_id": app["app_id"],
        "name": "AICritique_Evaluator",
        "evaluator_key": "auto_ai_critique",
        "settings_values": {
            "open_ai_key": OPEN_AI_KEY,
            "temperature": 0.9,
            "evaluation_prompt_template": "We have an LLM App that we want to evaluate its outputs. Based on the prompt and the parameters provided below evaluate the output based on the evaluation strategy below: Evaluation strategy: 0 to 10 0 is very bad and 10 is very good. Prompt: {llm_app_prompt_template} Inputs: country: {country} Correct Answer:{correct_answer} Evaluate this: {variant_output} Answer ONLY with one of the given grading or evaluation options.",
            "llm_app_prompt_template": "",
            "llm_app_inputs": [{"input_name": "country", "input_value": "tunisia"}],
        },
    }
