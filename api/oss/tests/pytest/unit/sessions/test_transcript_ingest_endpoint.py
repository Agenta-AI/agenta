"""Unit tests for the admin transcript ingest endpoint."""

from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, Request

from oss.src.apis.fastapi.sessions.router import TranscriptsRouter
from oss.src.apis.fastapi.sessions.models import TranscriptIngestRequest


def _make_admin_request(app: FastAPI) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/admin/sessions/transcripts/ingest",
        "headers": [],
        "app": app,
    }
    request = Request(scope)
    request.state.admin = True
    return request


async def test_transcript_ingest_writes_to_stream():
    transcripts_service = AsyncMock()

    router = TranscriptsRouter(transcripts_service=transcripts_service)

    project_id = uuid4()
    session_id = uuid4()

    body = TranscriptIngestRequest(
        project_id=project_id,
        session_id=session_id,
        event_index=0,
        sender="user",
        payload={"text": "hello"},
    )

    app = FastAPI()
    request = _make_admin_request(app)

    with patch(
        "oss.src.apis.fastapi.sessions.router.publish_transcript",
        new_callable=AsyncMock,
        return_value=True,
    ) as mock_publish:
        result = await router.ingest_transcript_event(request=request, body=body)

    assert result == {"ok": True}
    mock_publish.assert_awaited_once()

    call_kwargs = mock_publish.await_args.kwargs
    assert call_kwargs["project_id"] == project_id
    event = call_kwargs["transcript_event"]
    assert event.session_id == session_id
    assert event.project_id == project_id
    assert event.sender == "user"
    assert event.payload == {"text": "hello"}


async def test_transcript_ingest_rejects_non_admin():
    from fastapi import HTTPException

    transcripts_service = AsyncMock()
    router = TranscriptsRouter(transcripts_service=transcripts_service)

    project_id = uuid4()
    session_id = uuid4()
    body = TranscriptIngestRequest(project_id=project_id, session_id=session_id)

    app = FastAPI()
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/admin/sessions/transcripts/ingest",
        "headers": [],
        "app": app,
    }
    request = Request(scope)
    # no request.state.admin set → getattr returns False

    with pytest.raises(HTTPException) as exc_info:
        await router.ingest_transcript_event(request=request, body=body)

    assert exc_info.value.status_code == 403
