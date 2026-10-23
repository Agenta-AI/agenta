from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.sessions.router import (
    SessionsRootRouter,
    SessionStreamsRouter,
)
from oss.src.apis.fastapi.sessions.utils import sanitize_session_stream
from oss.src.core.sessions.dtos import SessionListItem, SessionQueryPage
from oss.src.core.sessions.streams.dtos import (
    CommandMode,
    SessionHeartbeatResult,
    SessionStream,
    SessionStreamCommandResponse,
)
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.sharing.dtos import SessionReadScope, Visibility
from oss.src.core.sessions.types import (
    SessionDelivery,
    SessionOrigin,
    SessionTrigger,
    SessionTriggerKind,
)
from oss.tests.pytest.utils.principals import make_envelope
from oss.tests.pytest.utils.sharing import NoopRunAdmission


RESERVED_TAGS = {
    "ag.origin": "trigger",
    "ag.trigger.id": "configuration-id",
    "ag.trigger.kind": "schedule",
    "ag.trigger.delivery_id": "delivery-id",
    "ag.trigger.name": "Legacy name",
    # P3-7: the whole "ag." namespace is reserved, not just the five exact
    # attribution keys above — these two used to be preserved as "caller-owned"
    # and no longer are.
    "ag.trigger.custom": {"spacing": "  unchanged\n  ", "values": [1, None]},
    "ag.private": False,
}
USER_TAGS = {
    "team": "support",
}
ALL_TAGS = {**RESERVED_TAGS, **USER_TAGS}


def _app(*routers) -> FastAPI:
    app = FastAPI()
    project_id = uuid4()
    user_id = uuid4()

    @app.middleware("http")
    async def set_request_scope(request: Request, call_next):
        request.state.project_id = str(project_id)
        request.state.user_id = str(user_id)
        return await call_next(request)

    for router in routers:
        app.include_router(router.router)
    return app


def _stream(*, tags=ALL_TAGS, session_id: str = "session-a") -> SessionStream:
    return SessionStream(
        id=uuid4(),
        project_id=uuid4(),
        session_id=session_id,
        tags=tags,
    )


def _assert_only_user_tags(stream: dict) -> None:
    assert stream["tags"] == USER_TAGS
    assert not RESERVED_TAGS.keys() & stream["tags"].keys()


def test_stream_sanitizer_returns_copies_without_mutating_service_dto():
    stream = _stream()

    sanitized = sanitize_session_stream(stream)

    assert sanitized is not stream
    assert sanitized.tags is not stream.tags
    assert sanitized.tags == USER_TAGS
    assert stream.tags == ALL_TAGS


def test_root_query_serialization_strips_reserved_tags_and_keeps_typed_attribution():
    trigger_id = uuid4()
    delivery_id = uuid4()
    attributed_data = _stream().model_dump()
    attributed_data.update(
        origin=SessionOrigin.trigger,
        trigger=SessionTrigger(
            id=trigger_id,
            kind=SessionTriggerKind.schedule,
            name="Current name",
        ),
        delivery=SessionDelivery(id=delivery_id),
    )
    attributed = SessionListItem(**attributed_data)
    untagged = SessionListItem(
        **_stream(tags=None, session_id="session-b").model_dump()
    )
    service = AsyncMock()
    service.query_sessions_page.return_value = SessionQueryPage(
        sessions=[attributed, untagged]
    )
    app = _app(SessionsRootRouter(sessions_service=service))

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = TestClient(app).post("/sessions/query", json={})

    assert response.status_code == 200
    sessions = response.json()["sessions"]
    _assert_only_user_tags(sessions[0])
    assert sessions[0]["origin"] == "trigger"
    assert sessions[0]["trigger"] == {
        "id": str(trigger_id),
        "kind": "schedule",
        "name": "Current name",
    }
    assert sessions[0]["delivery"] == {"id": str(delivery_id)}
    assert "tags" not in sessions[1]
    assert attributed.tags == ALL_TAGS
    assert untagged.tags is None


@pytest.mark.parametrize(
    ("path", "service_method"),
    [
        ("/sessions/archive?session_id=session-a", "archive_session"),
        ("/sessions/unarchive?session_id=session-a", "unarchive_session"),
    ],
)
def test_root_mutation_serialization_strips_only_reserved_tags(path, service_method):
    stream = _stream()
    service = AsyncMock()
    getattr(service, service_method).return_value = stream
    app = _app(SessionsRootRouter(sessions_service=service))

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = TestClient(app).post(path)

    assert response.status_code == 200
    _assert_only_user_tags(response.json()["session"])
    assert stream.tags == ALL_TAGS


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"header": {"name": "Wrapped"}},
    ],
)
def test_stream_header_rejects_noop_bodies_before_calling_service(payload):
    service = AsyncMock()
    app = _app(
        SessionStreamsRouter(
            service=service,
            interactions_service=AsyncMock(),
        )
    )

    response = TestClient(app).put(
        "/sessions/streams/header?session_id=session-a",
        json=payload,
    )

    assert response.status_code == 422
    service.set_header.assert_not_awaited()


def test_plain_stream_response_families_strip_only_reserved_tags():
    stream = _stream()
    untagged = _stream(tags=None, session_id="session-b")
    service = AsyncMock()
    service.fetch.return_value = stream
    service.query_streams.return_value = [stream, untagged]
    service.set_header.return_value = stream
    service.heartbeat.return_value = SessionHeartbeatResult(
        stream=stream,
        replica_id="replica-a",
    )
    service.command.return_value = SessionStreamCommandResponse(
        mode=CommandMode.cancel,
        session_id="session-a",
        detached=True,
    )
    app = _app(
        SessionStreamsRouter(
            service=service,
            interactions_service=AsyncMock(),
            run_admission=NoopRunAdmission(),
        )
    )
    client = TestClient(app)

    with (
        patch(
            "oss.src.apis.fastapi.sessions.router.check_action_access",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "oss.src.apis.fastapi.sessions.router.request_run_envelope",
            lambda _request: make_envelope(),
        ),
    ):
        fetch = client.get("/sessions/streams/?session_id=session-a")
        query = client.post("/sessions/streams/query", json={})
        header = client.put(
            "/sessions/streams/header?session_id=session-a",
            json={"name": "Renamed"},
        )
        heartbeat = client.post(
            "/sessions/streams/heartbeat",
            json={"session_id": "session-a", "replica_id": "replica-a"},
        )
        command = client.post(
            "/sessions/streams/",
            json={"session_id": "session-a"},
        )

    assert fetch.status_code == 200
    _assert_only_user_tags(fetch.json()["stream"])
    assert query.status_code == 200
    _assert_only_user_tags(query.json()["streams"][0])
    assert query.json()["streams"][1]["tags"] is None
    assert header.status_code == 200
    _assert_only_user_tags(header.json()["stream"])
    assert heartbeat.status_code == 200
    _assert_only_user_tags(heartbeat.json()["stream"])
    assert command.status_code == 200
    assert "tags" not in command.json()
    assert stream.tags == ALL_TAGS
    assert untagged.tags is None


def test_session_openapi_keeps_typed_attribution_and_generic_tags():
    app = _app(
        SessionsRootRouter(sessions_service=AsyncMock()),
        SessionStreamsRouter(
            service=AsyncMock(),
            interactions_service=AsyncMock(),
            run_admission=NoopRunAdmission(),
        ),
    )
    schemas = app.openapi()["components"]["schemas"]

    for schema_name in ("SessionStream", "SessionListItem"):
        properties = schemas[schema_name]["properties"]
        assert {"origin", "trigger", "delivery", "tags"} <= properties.keys()
        tag_shapes = properties["tags"]["anyOf"]
        assert any(
            shape.get("type") == "object" and shape.get("additionalProperties") is True
            for shape in tag_shapes
        )


def test_list_responses_keep_the_policy_fields(monkeypatch):
    """Both session lists carry each row's `visibility` and `owner_user_id`, and pass
    the read scope of the request's principal (`session_read_scope`, with the
    request's project) to the service."""

    import oss.src.apis.fastapi.sharing.utils as sharing_utils  # noqa: PLC0415

    owner_id = uuid4()
    principal = PrincipalRef(kind=PrincipalKind.HUMAN, id=owner_id)
    scope = SessionReadScope(
        owner_user_id=owner_id, include_project=True, granted_stream_ids=[uuid4()]
    )
    sharing = AsyncMock()
    sharing.session_read_scope.return_value = scope
    monkeypatch.setattr(sharing_utils, "get_sharing_service", lambda: sharing)

    stream = _stream().model_copy(
        update={"visibility": Visibility.PRIVATE, "owner_user_id": owner_id}
    )
    streams_service = AsyncMock()
    streams_service.query_streams.return_value = [stream]
    sessions_service = AsyncMock()
    sessions_service.query_sessions_page.return_value = SessionQueryPage(
        sessions=[SessionListItem(**stream.model_dump())]
    )
    app = _app(
        SessionsRootRouter(sessions_service=sessions_service),
        SessionStreamsRouter(
            service=streams_service,
            interactions_service=AsyncMock(),
            run_admission=NoopRunAdmission(),
        ),
    )

    @app.middleware("http")
    async def set_principal(request: Request, call_next):
        request.state.principal = principal
        return await call_next(request)

    client = TestClient(app)
    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        sessions = client.post("/sessions/query", json={})
        streams = client.post("/sessions/streams/query", json={})

    for row in (sessions.json()["sessions"][0], streams.json()["streams"][0]):
        assert row["visibility"] == "private"
        assert row["owner_user_id"] == str(owner_id)
    assert sessions_service.query_sessions_page.await_args.kwargs["read_scope"] == scope
    assert streams_service.query_streams.await_args.kwargs["read_scope"] == scope
    for call in sharing.session_read_scope.await_args_list:
        assert call.kwargs["principal"] == principal
        assert isinstance(call.kwargs["project_id"], UUID)
    assert sharing.session_read_scope.await_count == 2
