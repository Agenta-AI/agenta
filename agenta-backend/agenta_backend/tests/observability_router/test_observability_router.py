import json
import pytest
import random
from typing import List

from agenta_backend.models.db_models import (
    AppDB,
    ConfigDB,
    SpanDB,
    UserDB,
    TraceDB,
    OrganizationDB,
    ImageDB,
    AppVariantDB,
    VariantBaseDB,
)
from agenta_backend.models.db_engine import DBEngine
from agenta_backend.services import selectors

import httpx


# Initialize database engine
engine = DBEngine().engine()

# Initialize http client
test_client = httpx.AsyncClient()
timeout = httpx.Timeout(timeout=5, read=None, write=5)

# Set global variables
BACKEND_API_HOST = "http://localhost:8000"


@pytest.mark.asyncio
async def test_create_spans_endpoint(spans_db_data):
    response = await test_client.post(
        f"{BACKEND_API_HOST}/observability/spans/",
        json=spans_db_data[0],
        timeout=timeout,
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_create_user_and_org(user_create_data, organization_create_data):
    user_db = UserDB(**user_create_data)
    await engine.save(user_db)

    org_db = OrganizationDB(**organization_create_data, owner=str(user_db.id))
    await engine.save(org_db)

    user_db.organizations = [org_db.id]
    await engine.save(user_db)

    assert org_db.name == "Agenta"
    assert user_db.username == "agenta"
    assert user_db.organizations == [org_db.id]


@pytest.mark.asyncio
async def test_create_organization(organization_create_data):
    user_db = await engine.find_one(UserDB, UserDB.uid == "0")
    organization = OrganizationDB(
        **organization_create_data,
        type="default",
        owner=str(user_db.id),
        members=[user_db.id],
    )
    await engine.save(organization)


@pytest.mark.asyncio
async def test_create_image_in_db(image_create_data):
    user_db = await engine.find_one(UserDB, UserDB.uid == "0")
    organization_db = await engine.find_one(
        OrganizationDB, OrganizationDB.owner == str(user_db.id)
    )

    image_db = ImageDB(**image_create_data, user=user_db, organization=organization_db)
    await engine.save(image_db)

    assert image_db.user.id == user_db.id
    assert image_db.tags == image_create_data["tags"]


@pytest.mark.asyncio
async def test_create_appvariant_in_db(app_variant_create_data):
    user_db = await engine.find_one(UserDB, UserDB.uid == "0")
    organization_db = await selectors.get_user_own_org(user_db.uid)
    image_db = await engine.find_one(ImageDB, ImageDB.user == user_db.id)

    app = AppDB(
        app_name="test_app",
        organization=organization_db,
        user=user_db,
    )
    await engine.save(app)

    db_config = ConfigDB(
        config_name="default",
        parameters={},
    )
    await engine.save(db_config)

    db_base = VariantBaseDB(
        app=app,
        organization=organization_db,
        user=user_db,
        base_name="app",
        image=image_db,
    )
    await engine.save(db_base)

    app_variant_db = AppVariantDB(
        **app_variant_create_data,
        app=app,
        image=image_db,
        user=user_db,
        organization=organization_db,
        base_name="app",
        config_name="default",
        base=db_base,
        config=db_config,
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
    app_id, variant_id = variants[0].app.id, variants[0].id

    # Update trace_create_data
    payload = {
        "app_id": str(app_id),
        "variant_id": str(variant_id),
        **trace_create_data,
        "spans": spans_id,
    }
    response = await test_client.post(
        f"{BACKEND_API_HOST}/observability/traces/",
        json=payload,
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_get_traces_endpoint():
    variants = await engine.find(AppVariantDB)
    app_id, variant_id = variants[0].app.id, variants[0].id

    response = await test_client.get(
        f"{BACKEND_API_HOST}/observability/traces/{str(app_id)}/{str(variant_id)}/"
    )
    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_get_trace_endpoint():
    traces = await engine.find(TraceDB)

    variants = await engine.find(AppVariantDB)
    app_id, variant_id = variants[0].app.id, variants[0].id

    response = await test_client.get(
        f"{BACKEND_API_HOST}/observability/traces/{str(traces[0].id)}/"
    )
    assert response.status_code == 200
    assert len(response.json()["spans"]) == 3
    assert response.json()["app_id"] == str(app_id)
    assert response.json()["variant_id"] == str(variant_id)


@pytest.mark.asyncio
async def test_update_trace_status_endpoint():
    payload = {
        "status": random.choice(["initiated", "completed", "stopped", "cancelled"])
    }

    traces = await engine.find(TraceDB)
    response = await test_client.put(
        f"{BACKEND_API_HOST}/observability/traces/{str(traces[0].id)}/",
        json=payload,
    )
    assert response.status_code == 200
    assert response.json() == True


@pytest.mark.asyncio
async def test_create_feedback_endpoint(feedbacks_create_data):
    traces = await engine.find(TraceDB)
    for feedback_data in feedbacks_create_data:
        response = await test_client.post(
            f"{BACKEND_API_HOST}/observability/feedbacks/{str(traces[0].id)}/",
            json=feedback_data,
        )
        assert response.status_code == 200
        assert type(response.json()) == str


@pytest.mark.asyncio
async def test_get_trace_feedbacks_endpoint():
    traces = await engine.find(TraceDB)
    response = await test_client.get(
        f"{BACKEND_API_HOST}/observability/feedbacks/{str(traces[0].id)}/"
    )
    assert response.status_code == 200
    assert len(response.json()) == 2


@pytest.mark.asyncio
async def test_get_feedback_endpoint():
    traces = await engine.find(TraceDB)
    feedback_id = traces[0].feedbacks[0].uid
    response = await test_client.get(
        f"{BACKEND_API_HOST}/observability/feedbacks/{str(traces[0].id)}/{feedback_id}/"
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
            f"{BACKEND_API_HOST}/observability/feedbacks/{str(traces[0].id)}/{feedback_id}/",
            json=feedback_data,
        )
        assert response.status_code == 200
        assert response.json()["feedback_id"] == feedback_id
