"""Unit tests for the credential-authed transcript ingest endpoint.

The runner authenticates AS the invoke caller; project scope comes from the credential
(``request.state.project_id``), never the body, and access is gated by RUN_SESSIONS.
"""

from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, Request

from oss.src.apis.fastapi.sessions.router import TranscriptsRouter
from oss.src.apis.fastapi.sessions.models import SessionTranscriptIngestRequest


def _make_authed_request(app: FastAPI, project_id, user_id) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/sessions/transcripts/ingest",
        "headers": [],
        "app": app,
    }
    request = Request(scope)
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    return request


async def test_transcript_ingest_writes_to_stream():
    transcripts_service = AsyncMock()

    router = TranscriptsRouter(transcripts_service=transcripts_service)

    project_id = uuid4()
    user_id = uuid4()
    session_id = uuid4()

    body = SessionTranscriptIngestRequest(
        session_id=str(session_id),
        event_index=0,
        sender="user",
        payload={"text": "hello"},
    )

    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id)

    with (
        patch(
            "oss.src.apis.fastapi.sessions.router.check_action_access",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "oss.src.apis.fastapi.sessions.router.publish_transcript",
            new_callable=AsyncMock,
            return_value=True,
        ) as mock_publish,
    ):
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


async def test_transcript_ingest_rejects_without_permission():
    from fastapi import HTTPException

    transcripts_service = AsyncMock()
    router = TranscriptsRouter(transcripts_service=transcripts_service)

    project_id = uuid4()
    user_id = uuid4()
    session_id = uuid4()
    body = SessionTranscriptIngestRequest(session_id=str(session_id))

    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id)

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=False,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await router.ingest_transcript_event(request=request, body=body)

    assert exc_info.value.status_code == 403
