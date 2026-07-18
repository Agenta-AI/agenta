"""WP5 (S7): SessionsRootRouter — /sessions/query, DELETE /sessions/,
/sessions/archive, /sessions/unarchive.

Mirrors test_record_ingest_endpoint.py's pattern: a mock Request +
patched check_action_access, so RBAC gating and service delegation are
pinned without a live app/DB. Covers:

  - query_sessions: VIEW_SESSIONS gate; delegates to SessionsService.query_sessions
    with the parsed SessionQuery + windowing.
  - delete_session: EDIT_SESSIONS gate; delegates to SessionsService.delete_session
    keyed by session_id (the query param), not stream_id.
  - archive_session / unarchive_session: EDIT_SESSIONS gate; delegate to the
    matching SessionsService methods.
  - every mutation rejects without permission.
"""

from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException, Request

from oss.src.apis.fastapi.sessions.router import SessionsRootRouter
from oss.src.apis.fastapi.sessions.models import SessionQueryRequest
from oss.src.core.shared.dtos import Reference, Windowing


def _make_authed_request(app: FastAPI, project_id, user_id, method="POST") -> Request:
    scope = {
        "type": "http",
        "method": method,
        "path": "/sessions/",
        "headers": [],
        "app": app,
    }
    request = Request(scope)
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    return request


def _patched_access(allowed: bool):
    return patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=allowed,
    )


# ---------------------------------------------------------------------------
# query_sessions
# ---------------------------------------------------------------------------


async def test_query_sessions_delegates_to_service():
    sessions_service = AsyncMock()
    sessions_service.query_sessions.return_value = []
    router = SessionsRootRouter(sessions_service=sessions_service)

    project_id = uuid4()
    user_id = uuid4()
    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id)

    target_ref = Reference(id=uuid4(), slug="wf", version="v1")
    body = SessionQueryRequest(
        references=[target_ref], windowing=Windowing(order="descending")
    )

    with _patched_access(True):
        result = await router.query_sessions(request=request, body=body)

    assert result.count == 0
    sessions_service.query_sessions.assert_awaited_once()
    call_kwargs = sessions_service.query_sessions.await_args.kwargs
    assert call_kwargs["project_id"] == project_id
    assert call_kwargs["query"].references == [target_ref]
    assert call_kwargs["windowing"].order == "descending"


async def test_query_sessions_rejects_without_view_permission():
    sessions_service = AsyncMock()
    router = SessionsRootRouter(sessions_service=sessions_service)

    project_id = uuid4()
    user_id = uuid4()
    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id)

    with _patched_access(False):
        with pytest.raises(HTTPException) as exc_info:
            await router.query_sessions(request=request, body=SessionQueryRequest())

    assert exc_info.value.status_code == 403
    sessions_service.query_sessions.assert_not_awaited()


# ---------------------------------------------------------------------------
# delete_session
# ---------------------------------------------------------------------------


async def test_delete_session_delegates_to_service_keyed_by_session_id():
    sessions_service = AsyncMock()
    router = SessionsRootRouter(sessions_service=sessions_service)

    project_id = uuid4()
    user_id = uuid4()
    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id, method="DELETE")

    with _patched_access(True):
        result = await router.delete_session(request=request, session_id="sess-1")

    assert result == {"ok": True}
    sessions_service.delete_session.assert_awaited_once()
    call_kwargs = sessions_service.delete_session.await_args.kwargs
    assert call_kwargs["project_id"] == project_id
    assert call_kwargs["session_id"] == "sess-1"
    assert "stream_id" not in call_kwargs


async def test_delete_session_rejects_without_edit_permission():
    sessions_service = AsyncMock()
    router = SessionsRootRouter(sessions_service=sessions_service)

    project_id = uuid4()
    user_id = uuid4()
    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id, method="DELETE")

    with _patched_access(False):
        with pytest.raises(HTTPException) as exc_info:
            await router.delete_session(request=request, session_id="sess-1")

    assert exc_info.value.status_code == 403
    sessions_service.delete_session.assert_not_awaited()


async def test_delete_session_rejects_invalid_session_id():
    sessions_service = AsyncMock()
    router = SessionsRootRouter(sessions_service=sessions_service)

    project_id = uuid4()
    user_id = uuid4()
    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id, method="DELETE")

    with pytest.raises(HTTPException) as exc_info:
        await router.delete_session(request=request, session_id="../etc/passwd")

    assert exc_info.value.status_code == 400
    sessions_service.delete_session.assert_not_awaited()


# ---------------------------------------------------------------------------
# archive_session / unarchive_session
# ---------------------------------------------------------------------------


async def test_archive_session_delegates_to_service():
    from oss.src.core.sessions.streams.dtos import SessionStream

    sessions_service = AsyncMock()
    project_id = uuid4()
    user_id = uuid4()
    sessions_service.archive_session.return_value = SessionStream(
        id=uuid4(), project_id=project_id, session_id="sess-1"
    )
    router = SessionsRootRouter(sessions_service=sessions_service)

    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id)

    with _patched_access(True):
        result = await router.archive_session(request=request, session_id="sess-1")

    assert result.count == 1
    sessions_service.archive_session.assert_awaited_once()
    call_kwargs = sessions_service.archive_session.await_args.kwargs
    assert call_kwargs["project_id"] == project_id
    assert call_kwargs["user_id"] == user_id
    assert call_kwargs["session_id"] == "sess-1"


async def test_archive_session_rejects_without_edit_permission():
    sessions_service = AsyncMock()
    router = SessionsRootRouter(sessions_service=sessions_service)

    project_id = uuid4()
    user_id = uuid4()
    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id)

    with _patched_access(False):
        with pytest.raises(HTTPException) as exc_info:
            await router.archive_session(request=request, session_id="sess-1")

    assert exc_info.value.status_code == 403
    sessions_service.archive_session.assert_not_awaited()


async def test_unarchive_session_delegates_to_service():
    sessions_service = AsyncMock()
    sessions_service.unarchive_session.return_value = None
    router = SessionsRootRouter(sessions_service=sessions_service)

    project_id = uuid4()
    user_id = uuid4()
    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id)

    with _patched_access(True):
        result = await router.unarchive_session(request=request, session_id="sess-1")

    assert result.count == 0
    sessions_service.unarchive_session.assert_awaited_once()
    call_kwargs = sessions_service.unarchive_session.await_args.kwargs
    assert call_kwargs["session_id"] == "sess-1"


async def test_unarchive_session_rejects_without_edit_permission():
    sessions_service = AsyncMock()
    router = SessionsRootRouter(sessions_service=sessions_service)

    project_id = uuid4()
    user_id = uuid4()
    app = FastAPI()
    request = _make_authed_request(app, project_id, user_id)

    with _patched_access(False):
        with pytest.raises(HTTPException) as exc_info:
            await router.unarchive_session(request=request, session_id="sess-1")

    assert exc_info.value.status_code == 403
    sessions_service.unarchive_session.assert_not_awaited()
