import os
import pytest
import logging
from datetime import datetime, timezone

from agenta_backend.models.db.postgres_engine import db_engine
from agenta_backend.models.shared_models import ConfigDB
from agenta_backend.models.db_models import (
    AppDB,
    UserDB,
    DeploymentDB,
    VariantBaseDB,
    ImageDB,
    AppVariantDB,
)
from agenta_backend.resources.evaluators.evaluators import get_all_evaluators

import httpx
from sqlalchemy.future import select


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

    async with db_engine.get_session() as session:
        result = await session.execute(select(UserDB).filter_by(uid="0"))
        user = result.scalars().first()
        if user is None:
            create_user = UserDB(uid="0")
            session.add(create_user)
            await session.commit()
            await session.refresh(create_user)
            return create_user
        return user


@pytest.fixture()
async def get_second_user_object():
    """Create a second user object."""

    async with db_engine.get_session() as session:
        result = await session.execute(select(UserDB).filter_by(uid="1"))
        user = result.scalars().first()
        if user is None:
            create_user = UserDB(
                uid="1", username="test_user1", email="test_user1@email.com"
            )
            session.add(create_user)
            await session.commit()
            await session.refresh(create_user)
            return create_user
        return user


@pytest.fixture()
async def get_first_user_app(get_first_user_object):
    user = await get_first_user_object

    async with db_engine.get_session() as session:
        app = AppDB(app_name="myapp", user_id=user.id)
        session.add(app)
        await session.commit()
        await session.refresh(app)

        db_image = ImageDB(
            docker_id="sha256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            tags="agentaai/templates_v2:local_test_prompt",
            user_id=user.id,
        )
        session.add(db_image)
        await session.commit()
        await session.refresh(db_image)

        db_config = ConfigDB(
            config_name="default",
            parameters={},
        )

        db_deployment = DeploymentDB(
            app_id=app.id,
            user_id=user.id,
            container_name="container_a_test",
            container_id="w243e34red",
            uri="http://localhost/app/w243e34red",
            status="stale",
        )
        session.add(db_deployment)

        db_base = VariantBaseDB(
            base_name="app",
            image_id=db_image.id,
            user_id=user.id,
            app_id=app.id,
            deployment_id=db_deployment.id,
        )
        session.add(db_base)
        await session.commit()
        await session.refresh(db_base)

        appvariant = AppVariantDB(
            app_id=app.id,
            variant_name="app",
            image_id=db_image.id,
            user_id=user.id,
            config_parameters={},
            base_name="app",
            config_name="default",
            base_id=db_base.id,
            revision=0,
            modified_by_id=user.id,
        )
        session.add(appvariant)
        await session.commit()
        await session.refresh(appvariant)

        return appvariant, user, app, db_image, db_config, db_base


@pytest.fixture(scope="session")
async def fetch_user():
    async with db_engine.get_session() as session:
        result = await session.execute(select(UserDB).filter_by(uid="0"))
        user = result.scalars().first()
        return user


@pytest.fixture()
def image_create_data():
    return {
        "docker_id": "sha256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "tags": "agentaai/templates_v2:local_test_prompt",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }


@pytest.fixture()
def app_variant_create_data():
    return {
        "variant_name": "v1",
        "parameters": {},
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }


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
def app_variant_parameters_updated():
    return {
        "parameters": {
            "temperature": 1.43,
            "model": "gpt-3.5-turbo",
            "max_tokens": 1182,
            "prompt_system": "You are an expert in geography. Answer in Japanese.",
            "prompt_user": "What is the capital of {country}?",
            "top_p": 1,
            "frequence_penalty": 1.4,
            "presence_penalty": 1.25,
            "force_json": 0,
        }
    }


@pytest.fixture()
def evaluators_requiring_llm_keys():
    evaluators_requiring_llm_keys = [
        evaluator["key"]
        for evaluator in get_all_evaluators()
        if evaluator["settings_template"]["requires_llm_api_keys"].get("default", False)
        is True
    ]
    return evaluators_requiring_llm_keys


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


@pytest.fixture()
def deploy_to_environment_payload():
    return {"environment_name": "string", "variant_id": "string"}
