from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, Request
from oss.src.apis.fastapi.sessions.router import SessionStreamsRouter
from oss.src.apis.fastapi.sessions.utils import current_session_response
from oss.src.core.access.permissions.types import Permission
from oss.src.core.sessions.streams.dtos import SessionStream
from oss.src.core.sessions.types import SessionReference


@pytest.fixture
def setup(monkeypatch):
    project_id, workspace_id, agent_id, user_id = [uuid4() for _ in range(4)]
    stream = SessionStream(
        id=uuid4(),
        project_id=project_id,
        session_id="session-1",
        name="QA session",
        references=[
            SessionReference(key="workflow_revision", id=uuid4()),
            SessionReference(key="workflow", id=agent_id),
        ],
        meta={"private": "not in tool output"},
    )
    service = AsyncMock()
    service.fetch.return_value = stream
    access = AsyncMock(return_value=True)
    monkeypatch.setattr(
        "oss.src.apis.fastapi.sessions.router.check_action_access", access
    )
    monkeypatch.setattr(
        "oss.src.apis.fastapi.sessions.router.env.agenta.web_url",
        "https://example.test",
    )
    app = FastAPI()

    @app.middleware("http")
    async def auth(request: Request, call_next):
        request.state.project_id = project_id
        request.state.workspace_id = workspace_id
        request.state.user_id = user_id
        return await call_next(request)

    app.include_router(
        SessionStreamsRouter(service=service, interactions_service=AsyncMock()).router
    )
    return SimpleNamespace(**locals())


async def post(setup, body):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=setup.app), base_url="http://test"
    ) as client:
        return await client.post("/sessions/tools/current", json=body)


async def test_reads_scoped_session_and_returns_only_link_metadata(setup):
    response = await post(setup, {"session_id": "session-1"})
    assert response.status_code == 200
    assert response.json() == {
        "session_id": "session-1",
        "name": "QA session",
        "url": f"https://example.test/w/{setup.workspace_id}/p/{setup.project_id}/apps/{setup.agent_id}/playground?session_id=session-1",
        "url_unavailable_reason": None,
    }
    setup.service.fetch.assert_awaited_once_with(
        project_id=setup.project_id, session_id="session-1"
    )
    setup.access.assert_awaited_once_with(
        user_uid=str(setup.user_id),
        project_id=str(setup.project_id),
        permission=Permission.VIEW_SESSIONS,
    )


async def test_checks_permission_before_read(setup):
    setup.access.return_value = False
    response = await post(setup, {"session_id": "session-1"})
    assert response.status_code == 403
    setup.service.fetch.assert_not_awaited()


async def test_missing_or_foreign_project_session_is_not_found(setup):
    setup.service.fetch.return_value = None
    response = await post(setup, {"session_id": "foreign-session"})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "session_not_found"
    assert response.json()["detail"]["retryable"] is False
    setup.service.fetch.assert_awaited_once_with(
        project_id=setup.project_id, session_id="foreign-session"
    )


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"session_id": ""},
        {"session_id": "../other"},
        {"session_id": "a" * 129},
        {"session_id": "session-1", "project_id": "other"},
        {"session_id": "session-1", "url": "https://other.test"},
    ],
)
async def test_closed_request_and_session_validation(setup, body):
    response = await post(setup, body)
    assert response.status_code == 422
    setup.service.fetch.assert_not_awaited()


@pytest.mark.parametrize(
    "base",
    [
        "https://selfhost.test",
        "http://localhost:8780/",
        "https://selfhost.test/agenta/",
    ],
)
def test_web_origin_port_and_prefix(setup, base):
    result = current_session_response(
        stream=setup.stream, workspace_id=setup.workspace_id, web_url=base
    )
    assert (
        result.url
        == f"{base.rstrip('/')}/w/{setup.workspace_id}/p/{setup.project_id}/apps/{setup.agent_id}/playground?session_id=session-1"
    )


@pytest.mark.parametrize(
    "references",
    [
        None,
        [],
        [SessionReference(key="workflow_revision", id=uuid4())],
        [SessionReference(id=uuid4())],
    ],
)
def test_no_guess_from_missing_or_untyped_reference(setup, references):
    setup.stream.references = references
    result = current_session_response(
        stream=setup.stream,
        workspace_id=setup.workspace_id,
        web_url="https://example.test",
    )
    assert result.url is None
    assert result.url_unavailable_reason == "agent_reference_missing"
    assert result.session_id == "session-1"


@pytest.mark.parametrize(
    "base",
    [
        "",
        "not-a-url",
        "file:///tmp",
        "https://user:secret@example.test",
        "https://example.test?redirect=other",
        "https://example.test#fragment",
        "https://example.test:notaport",
        "https://example.test:65536",
        "https://example.test:-1",
        "https://[",
    ],
)
def test_invalid_public_origin_does_not_leak_a_link(setup, base):
    result = current_session_response(
        stream=setup.stream, workspace_id=setup.workspace_id, web_url=base
    )
    assert result.url is None
    assert result.url_unavailable_reason == "web_url_unavailable"


def test_missing_workspace_and_unnamed_session(setup):
    setup.stream.name = None
    result = current_session_response(
        stream=setup.stream, workspace_id=None, web_url="https://example.test"
    )
    assert result.name is None
    assert result.url is None
    assert result.url_unavailable_reason == "workspace_missing"
