import pytest
import asyncio
from bson import ObjectId
from datetime import datetime

from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.db_models import (
    UserDB,
    OrganizationDB,
)

# Initialize database engine
engine = DBEngine(mode="test").engine()


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
        "docker_id": "sha256:a3e04735de9ac4f8f11a8ab1f3a9e1d7dff28b28501ca774f4bbca6ae07c2d66",
        "tags": "agentaai/templates:single_prompt",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }


@pytest.fixture()
def app_variant_create_data():
    return {
        "app_name": "test_app",
        "variant_name": "v1",
        "parameters": {},
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }


@pytest.fixture()
def trace_create_data(app_variant_create_data):
    return {
        "app_name": app_variant_create_data["app_name"],
        "variant_name": app_variant_create_data["variant_name"],
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


@pytest.fixture(scope="function")
async def create_first_organization_data():
    """Create an OrganizationDB instance for testing."""
    organization = OrganizationDB(
        name="Test Organization 1",
        description="Description For Test Organization 1",
        type="default",
    )
    await engine.save(organization)
    yield organization
    organization.delete()


@pytest.fixture(scope="function")
async def create_first_user():
    """Create a UserDB instance for testing."""
    user1 = UserDB(
        uid="0",
        username="TestUser1",
        email="testuser1@example.com",
    )
    await engine.save(user1)
    yield user1
    user1.delete()
