import os
import pytest
import logging
from datetime import datetime

from agenta_backend.models.db_models import (
    AppDB,
    UserDB,
    VariantBaseDB,
    ImageDB,
    ConfigDB,
    AppVariantDB,
)

import httpx


# Initialize logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Set global variables
ENVIRONMENT = os.environ.get("ENVIRONMENT")
OPEN_AI_KEY = os.environ.get("OPENAI_API_KEY")
if ENVIRONMENT == "development":
    BACKEND_API_HOST = "http://host.docker.internal/api"
elif ENVIRONMENT == "github":
    BACKEND_API_HOST = "http://agenta-backend-test:8000"


@pytest.fixture()
async def get_first_user_object():
    """Get the user object from the database or create a new one if not found."""

    user = await UserDB.find_one(UserDB.uid == "0")
    if user is None:
        create_user = UserDB(uid="0")
        await create_user.create()

        return create_user
    return user


@pytest.fixture()
async def get_second_user_object():
    """Create a second user object."""

    user = await UserDB.find_one(UserDB.uid == "1")
    if user is None:
        create_user = UserDB(
            uid="1", username="test_user1", email="test_user1@email.com"
        )
        await create_user.create()

        return create_user
    return user


@pytest.fixture()
async def get_first_user_app(get_first_user_object):
    user = await get_first_user_object

    app = AppDB(app_name="myapp", user=user)
    await app.create()

    db_image = ImageDB(
        docker_id="sha256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        tags="agentaai/templates_v2:local_test_prompt",
        user=user,
    )
    await db_image.create()

    db_config = ConfigDB(
        config_name="default",
        parameters={},
    )

    db_base = VariantBaseDB(base_name="app", image=db_image, user=user, app=app)
    await db_base.create()

    appvariant = AppVariantDB(
        app=app,
        variant_name="app",
        image=db_image,
        user=user,
        parameters={},
        base_name="app",
        config_name="default",
        base=db_base,
        revision=0,
        modified_by=user,
        config=db_config,
    )
    await appvariant.create()
    return appvariant, user, app, db_image, db_config, db_base


@pytest.fixture()
def spans_db_data():
    return [
        {
            "parent_span_id": "string",
            "meta": {},
            "event_name": "call",
            "event_type": "fixture_call",
            "start_time": str(datetime.utcnow()),
            "duration": 8.30,
            "status": "initiated",
            "end_time": str(datetime.utcnow()),
            "inputs": ["string"],
            "outputs": ["string"],
            "prompt_template": "string",
            "tokens_input": 80,
            "tokens_output": 25,
            "token_total": 105,
            "cost": 0.23,
            "tags": ["string"],
        },
        {
            "parent_span_id": "string",
            "meta": {},
            "event_name": "call",
            "event_type": "fixture_call",
            "start_time": str(datetime.utcnow()),
            "duration": 13.30,
            "status": "initiated",
            "end_time": str(datetime.utcnow()),
            "inputs": ["string"],
            "outputs": ["string"],
            "prompt_template": "string",
            "tokens_input": 58,
            "tokens_output": 65,
            "token_total": 123,
            "cost": 0.19,
            "tags": ["string"],
        },
        {
            "parent_span_id": "string",
            "meta": {},
            "event_name": "call",
            "event_type": "fixture_call",
            "start_time": str(datetime.utcnow()),
            "duration": 18.30,
            "status": "initiated",
            "end_time": str(datetime.utcnow()),
            "inputs": ["string"],
            "outputs": ["string"],
            "prompt_template": "string",
            "tokens_input": 100,
            "tokens_output": 35,
            "token_total": 135,
            "cost": 0.54,
            "tags": ["string"],
        },
    ]


@pytest.fixture()
def image_create_data():
    return {
        "docker_id": "sha256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "tags": "agentaai/templates_v2:local_test_prompt",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }


@pytest.fixture()
def app_variant_create_data():
    return {
        "variant_name": "v1",
        "parameters": {},
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }


@pytest.fixture()
def trace_create_data():
    return {
        "cost": 0.782,
        "latency": 20,
        "status": "completed",
        "token_consumption": 638,
        "tags": ["string"],
        "start_time": str(datetime.utcnow()),
        "end_time": str(datetime.utcnow()),
    }


@pytest.fixture()
def feedbacks_create_data():
    return [
        {"feedback": "thumbs up", "score": 0, "meta": {}},
        {"feedback": "thumbs down", "score": 10, "meta": {}},
    ]


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
    return next(
        (temp for temp in fetch_templates if temp["image"]["name"] == "chat_openai"),
        None,
    )


@pytest.fixture()
def app_from_template():
    return {
        "app_name": "string",
        "env_vars": {"OPENAI_API_KEY": OPEN_AI_KEY},
        "template_id": "string",
    }


@pytest.fixture(scope="session")
async def fetch_user():
    user = await UserDB.find_one(UserDB.uid == "0", fetch_links=True)
    return user


@pytest.fixture()
def update_app_variant_parameters():
    return {
        "temperature": 1,
        "model": "gpt-3.5-turbo",
        "max_tokens": -1,
        "prompt_system": "You are an expert in geography.",
        "prompt_user": "What is the capital of {country}?",
        "top_p": 1,
        "frequence_penalty": 0,
        "presence_penalty": 0,
    }


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
    return {
        "app_id": "string",
        "name": "WebhookEvaluator",
        "evaluator_key": "auto_webhook_test",
        "settings_values": {
            "webhook_url": f"{BACKEND_API_HOST}/evaluations/webhook_example_fake/",
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
            "prompt_template": "We have an LLM App that we want to evaluate its outputs. Based on the prompt and the parameters provided below evaluate the output based on the evaluation strategy below: Evaluation strategy: 0 to 10 0 is very bad and 10 is very good. Prompt: {llm_app_prompt_template} Inputs: country: {country} Correct Answer:{correct_answer} Evaluate this: {variant_output} Answer ONLY with one of the given grading or evaluation options.",
        },
    }
