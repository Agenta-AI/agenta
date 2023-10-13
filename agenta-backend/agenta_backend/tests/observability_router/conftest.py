import pytest
from datetime import datetime

from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.db_models import OrganizationDB


# Initialize database engine
engine = DBEngine().engine()


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
        "tags": "agentaai/templates:local_test_prompt",
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
def organization_create_data():
    return {
        "name": "Agenta",
        "description": "Agenta is a platform for building and deploying machine learning models.",
    }


@pytest.fixture()
def user_create_data():
    return {
        "uid": "0",
        "username": "agenta",
        "email": "demo@agenta.ai",
    }


@pytest.fixture()
def feedbacks_create_data():
    return [
        {"feedback": "thumbs up", "score": 0, "meta": {}},
        {"feedback": "thumbs down", "score": 10, "meta": {}},
    ]
