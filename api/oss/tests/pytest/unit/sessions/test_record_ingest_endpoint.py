"""Unit tests for the credential-authed record ingest endpoint.

The runner authenticates AS the invoke caller; project scope comes from the credential
(``request.state.project_id``), never the body, and access is gated by RUN_SESSIONS.
"""

from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, Request

from oss.src.apis.fastapi.sessions.router import RecordsRouter
from oss.src.apis.fastapi.sessions.models import SessionRecordIngestRequest


def _make_authed_request(app: FastAPI, project_id, user_id, organization_id) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/sessions/records/ingest",
        "headers": [],
        "app": app,
    }
    request = Request(scope)
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    request.state.organization_id = str(organization_id)
    return request


async def test_record_ingest_writes_to_stream():
    records_service = AsyncMock()

    router = RecordsRouter(records_service=records_service)

    project_id = uuid4()
    user_id = uuid4()
    organization_id = uuid4()
    session_id = uuid4()

    body = SessionRecordIngestRequest(
        session_id=str(session_id),
        record_index=0,
        record_source="user",
        attributes={"text": "hello"},
    )

    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id, organization_id)

    with (
        patch(
            "oss.src.apis.fastapi.sessions.router.check_action_access",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "oss.src.apis.fastapi.sessions.router.publish_record",
            new_callable=AsyncMock,
            return_value=True,
        ) as mock_publish,
    ):
        result = await router.ingest_record_event(request=request, body=body)

    assert result == {"ok": True}
    mock_publish.assert_awaited_once()

    call_kwargs = mock_publish.await_args.kwargs
    assert call_kwargs["organization_id"] == organization_id
    assert call_kwargs["project_id"] == project_id
    event = call_kwargs["record_event"]
    assert event.session_id == str(session_id)
    assert event.project_id == project_id
    assert event.record_source == "user"
    assert event.attributes == {"text": "hello"}


async def test_record_ingest_rejects_without_permission():
    from fastapi import HTTPException

    records_service = AsyncMock()
    router = RecordsRouter(records_service=records_service)

    project_id = uuid4()
    user_id = uuid4()
    organization_id = uuid4()
    session_id = uuid4()
    body = SessionRecordIngestRequest(session_id=str(session_id))

    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id, organization_id)

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=False,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await router.ingest_record_event(request=request, body=body)

    assert exc_info.value.status_code == 403


async def test_record_ingest_threads_turn_id_and_span_id():
    records_service = AsyncMock()
    router = RecordsRouter(records_service=records_service)

    project_id = uuid4()
    user_id = uuid4()
    organization_id = uuid4()
    session_id = uuid4()
    span_id = uuid4()

    body = SessionRecordIngestRequest(
        session_id=str(session_id),
        record_index=0,
        record_source="agent",
        attributes={"type": "message"},
        turn_id="turn-abc",
        span_id=span_id,
    )

    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id, organization_id)

    with (
        patch(
            "oss.src.apis.fastapi.sessions.router.check_action_access",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "oss.src.apis.fastapi.sessions.router.publish_record",
            new_callable=AsyncMock,
            return_value=True,
        ) as mock_publish,
    ):
        await router.ingest_record_event(request=request, body=body)

    event = mock_publish.await_args.kwargs["record_event"]
    assert event.turn_id == "turn-abc"
    assert event.span_id == span_id


async def test_record_ingest_defaults_turn_id_and_span_id_to_none():
    records_service = AsyncMock()
    router = RecordsRouter(records_service=records_service)

    project_id = uuid4()
    user_id = uuid4()
    organization_id = uuid4()
    session_id = uuid4()

    body = SessionRecordIngestRequest(session_id=str(session_id))

    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id, organization_id)

    with (
        patch(
            "oss.src.apis.fastapi.sessions.router.check_action_access",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "oss.src.apis.fastapi.sessions.router.publish_record",
            new_callable=AsyncMock,
            return_value=True,
        ) as mock_publish,
    ):
        await router.ingest_record_event(request=request, body=body)

    event = mock_publish.await_args.kwargs["record_event"]
    assert event.turn_id is None
    assert event.span_id is None
