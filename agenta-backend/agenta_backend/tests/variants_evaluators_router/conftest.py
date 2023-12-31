import os
import httpx
import pytest

from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.db_models import (
    UserDB,
    OrganizationDB,
)


# Initialize database engine
engine = DBEngine().engine()

# Set global variables
ENVIRONMENT = os.environ.get("ENVIRONMENT")
OPEN_AI_KEY = os.environ.get("OPENAI_API_KEY")

if ENVIRONMENT == "development":
    BACKEND_API_HOST = "http://localhost:8000"
elif ENVIRONMENT == "test":  # github actions environment
    BACKEND_API_HOST = "http://localhost/api"


@pytest.fixture(scope="session")
def fetch_templates():
    response = httpx.get(f"{BACKEND_API_HOST}/containers/templates/")
    response_data = response.json()
    return response_data


@pytest.fixture(scope="session")
def use_open_ai_key():
    return OPEN_AI_KEY


@pytest.fixture(scope="session")
def fetch_single_prompt_template(fetch_templates):
    return fetch_templates[1]


@pytest.fixture()
async def fetch_user_organization():
    organization = await engine.find(OrganizationDB)
    return {"org_id": str(organization[0].id)}


@pytest.fixture()
def app_from_template():
    return {
        "app_name": "string",
        "env_vars": {"OPENAI_API_KEY": OPEN_AI_KEY},
        "organization_id": "string",
        "template_id": "string",
    }


@pytest.fixture(scope="session")
async def fetch_user():
    user = await engine.find_one(UserDB, UserDB.uid == "0")
    return user


@pytest.fixture()
def auto_exact_match_evaluator_config():
    return {
        "app_id": "string",
        "name": "ExactMatchEvaluator",
        "evaluator_key": "auto_exact_match",
        "settings_values": {},
    }


@pytest.fixture()
def auto_similarity_match_evaluator_config():
    return {
        "app_id": "string",
        "name": "SimilarityMatchEvaluator",
        "evaluator_key": "auto_similarity_match",
        "settings_values": {"similarity_threshold": 0.3},
    }


@pytest.fixture()
def auto_regex_test_evaluator_config():
    return {
        "app_id": "string",
        "name": "RegexEvaluator",
        "evaluator_key": "auto_regex_test",
        "settings_values": {
            "regex_pattern": "^value\\d{3}$",
            "regex_should_match": False,
        },
    }


@pytest.fixture()
def auto_webhook_test_evaluator_config():
    url = (
        "http://host.docker.internal/api"
        if ENVIRONMENT == "development"
        else "http://agenta-backend-test:8000"
    )
    return {
        "app_id": "string",
        "name": "WebhookEvaluator",
        "evaluator_key": "auto_webhook_test",
        "settings_values": {
            "webhook_url": f"{url}/evaluations/webhook_example_fake/",
            "webhook_body": {},
        },
    }


@pytest.fixture()
def auto_ai_critique_evaluator_config():
    return {
        "app_id": "string",
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
