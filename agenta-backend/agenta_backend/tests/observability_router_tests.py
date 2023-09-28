import pytest
import random
from typing import List

from agenta_backend.models.db_models import (
    SpanDB,
    UserDB,
    TraceDB,
    OrganizationDB,
    ImageDB,
    AppVariantDB,
)
from agenta_backend.models.db_engine import DBEngine

import httpx


# Initialize database engine
engine = DBEngine(mode="test").engine()

# Initialize http client
test_client = httpx.AsyncClient()


@pytest.mark.asyncio
async def test_create_spans_endpoint(spans_db_data):
    response = await test_client.post(
        "http://localhost:8000/observability/spans/",
        json=spans_db_data[0],
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_create_user_and_org(user_create_data, organization_create_data):
    org_db = OrganizationDB(**organization_create_data)
    await engine.save(org_db)

    user_db = UserDB(**user_create_data, organization=org_db)
    await engine.save(user_db)

    assert org_db.name == "Agenta"
    assert user_db.username == "agenta"
    assert user_db.organization.id == org_db.id


@pytest.mark.asyncio
async def test_create_image_in_db(image_create_data):
    user_db = await engine.find_one(UserDB, UserDB.uid == "0")

    image_db = ImageDB(**image_create_data, user=user_db)
    await engine.save(image_db)

    assert image_db.user.id == user_db.id
    assert image_db.tags == "agentaai/templates:local_test_prompt"


@pytest.mark.asyncio
async def test_create_appvariant_in_db(app_variant_create_data):
    user_db = await engine.find_one(UserDB, UserDB.uid == "0")

    image_db = await engine.find_one(ImageDB, ImageDB.user == user_db.id)

    app_variant_db = AppVariantDB(
        **app_variant_create_data, image=image_db, user=user_db
    )
    await engine.save(app_variant_db)

    assert app_variant_db.image.id == image_db.id
    assert app_variant_db.user.id == user_db.id


@pytest.mark.asyncio
async def test_create_spans_in_db(spans_db_data):
    # Set previous span id to None and
    # first span id used to False
    previous_span_id = None
    first_span_id_used = False

    # Remove first item in a list (because we are
    # already using it in the first test)
    spans_db_data.pop(0)

    for span_data in spans_db_data:
        # In this case, we are getting the first span id that was
        # created in the first test and updating the previous_span_id with it
        if previous_span_id is None and not first_span_id_used:
            first_span = await engine.find_one(SpanDB)
            previous_span_id = str(first_span.id)

        # Create a new span instance
        span_db = SpanDB(**span_data)

        # Set the parent_span_id to the new span instance if it exists
        if previous_span_id is not None:
            span_db.parent_span_id = previous_span_id

        # Save the span instance and set the first_span_id_used
        # to True to avoid reusing it
        await engine.save(span_db)
        first_span_id_used = True

        # Check if the previous span id exists and that first_span_id_used is True
        # if so, set the previous_span_id to the span that was created
        if previous_span_id is not None and first_span_id_used:
            previous_span_id = str(span_db.id)

    assert len(spans_db_data) == 2


@pytest.mark.asyncio
async def fetch_spans_id():
    spans = await engine.find(SpanDB)
    assert type(spans) == List[SpanDB]
    assert len(spans) == 3


@pytest.mark.asyncio
async def test_create_trace_endpoint(trace_create_data):
    spans = await engine.find(SpanDB)
    variants = await engine.find(AppVariantDB)

    # Prepare required data
    spans_id = [str(span.id) for span in spans]
    app_name, variant_name = variants[0].app_name, variants[0].variant_name

    # Update trace_create_data
    trace_create_data["app_name"] = app_name
    trace_create_data["variant_name"] = variant_name
    trace_create_data["spans"] = spans_id

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://localhost:8000/observability/traces/",
            json=trace_create_data,
        )
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_get_traces_endpoint():
    response = await test_client.get(
        "http://localhost:8000/observability/traces/test_app/v1/"
    )
    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_get_trace_endpoint():
    traces = await engine.find(TraceDB)

    response = await test_client.get(
        f"http://localhost:8000/observability/traces/{str(traces[0].id)}/"
    )
    assert response.status_code == 200
    assert len(response.json()["spans"]) == 3
    assert response.json()["app_name"] == "test_app"
    assert response.json()["variant_name"] == "v1"


@pytest.mark.asyncio
async def test_update_trace_status_endpoint():
    payload = {
        "status": random.choice(["initiated", "completed", "stopped", "cancelled"])
    }

    traces = await engine.find(TraceDB)
    response = await test_client.put(
        f"http://localhost:8000/observability/traces/{str(traces[0].id)}/",
        json=payload,
    )
    assert response.status_code == 200
    assert response.json() == True


@pytest.mark.asyncio
async def test_create_feedback_endpoint(feedbacks_create_data):
    traces = await engine.find(TraceDB)
    for feedback_data in feedbacks_create_data:
        response = await test_client.post(
            f"http://localhost:8000/observability/feedbacks/{str(traces[0].id)}/",
            json=feedback_data,
        )
        assert response.status_code == 200
        assert type(response.json()) == str


@pytest.mark.asyncio
async def test_get_trace_feedbacks_endpoint():
    traces = await engine.find(TraceDB)
    response = await test_client.get(
        f"http://localhost:8000/observability/feedbacks/{str(traces[0].id)}/"
    )
    assert response.status_code == 200
    assert len(response.json()) == 2


@pytest.mark.asyncio
async def test_get_feedback_endpoint():
    traces = await engine.find(TraceDB)
    feedback_id = traces[0].feedbacks[0].uid
    response = await test_client.get(
        f"http://localhost:8000/observability/feedbacks/{str(traces[0].id)}/{feedback_id}/"
    )
    assert response.status_code == 200
    assert response.json()["feedback_id"] == feedback_id


@pytest.mark.asyncio
async def test_update_feedback_endpoint():
    traces = await engine.find(TraceDB)
    feedbacks_ids = [feedback.uid for feedback in traces[0].feedbacks]

    for feedback_id in feedbacks_ids:
        feedback_data = {
            "feedback": random.choice(["thumbs up", "thumbs down"]),
            "score": random.choice([50, 30]),
        }
        response = await test_client.put(
            f"http://localhost:8000/observability/feedbacks/{str(traces[0].id)}/{feedback_id}/",
            json=feedback_data,
        )
        assert response.status_code == 200
        assert response.json()["feedback_id"] == feedback_id
