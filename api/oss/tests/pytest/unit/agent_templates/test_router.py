from copy import deepcopy
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient

from oss.src.apis.fastapi.agent_templates import router as router_module
from oss.src.apis.fastapi.agent_templates.router import AgentTemplatesRouter
from oss.src.core.access.permissions.types import Permission
from oss.src.core.agent_templates.dtos import (
    TemplateLoadResult,
    TemplateValidationIssue,
    TemplateValidationResult,
)
from oss.src.core.agent_templates.exceptions import (
    TemplateCreateConflict,
    TemplatePackageInvalid,
    TemplateSourceNotFound,
)
from oss.src.core.sessions.inputs.types import SessionInputIdempotencyConflict
from oss.src.core.sessions.starts.types import SessionStartNotDurable


PROJECT_ID = uuid4()
USER_ID = uuid4()


def _body():
    return {
        "source": {"kind": "internal", "key": "outbound-prospecting"},
        "base_revision": {
            "uri": "agenta:workflow:agent:v0",
            "parameters": {
                "agent": {
                    "llm": {"model": "openai/gpt-5"},
                    "harness": {"kind": "pi_core"},
                    "runner": {"kind": "sidecar"},
                    "sandbox": {"kind": "local"},
                }
            },
        },
        "initial_message": "Configure the agent.",
        "connection_choices": [],
    }


def _result(*, replayed=False):
    return TemplateLoadResult(
        workflow_id=uuid4(),
        workflow_slug="outbound-prospecting-12345678",
        variant_id=uuid4(),
        revision_id=uuid4(),
        session_id=str(uuid4()),
        execution_id=str(uuid4()),
        input_id=uuid4(),
        replayed=replayed,
    )


def _app(loader):
    app = FastAPI()

    @app.middleware("http")
    async def add_state(request: Request, call_next):
        request.state.project_id = str(PROJECT_ID)
        request.state.user_id = str(USER_ID)
        return await call_next(request)

    app.include_router(
        AgentTemplatesRouter(loader=loader).router,
        prefix="/api/agent-templates",
    )
    return app


async def _post(app, *, body=None, key="request-1"):
    headers = {"Idempotency-Key": key} if key is not None else {}
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        return await client.post(
            f"/api/agent-templates/load?project_id={PROJECT_ID}",
            headers=headers,
            json=body or _body(),
        )


@pytest.mark.asyncio
async def test_forbidden_request_does_not_call_loader(monkeypatch):
    loader = AsyncMock()
    access = AsyncMock(return_value=False)
    monkeypatch.setattr(router_module, "check_action_access", access)

    response = await _post(_app(loader))

    assert response.status_code == 403
    loader.load.assert_not_awaited()
    access.assert_awaited_once()


@pytest.mark.asyncio
async def test_both_edit_and_run_permissions_are_required(monkeypatch):
    loader = AsyncMock()
    access = AsyncMock(side_effect=[True, False])
    monkeypatch.setattr(router_module, "check_action_access", access)

    response = await _post(_app(loader))

    assert response.status_code == 403
    assert [call.kwargs["permission"] for call in access.await_args_list] == [
        Permission.EDIT_WORKFLOWS,
        Permission.RUN_SESSIONS,
    ]
    loader.load.assert_not_awaited()


@pytest.mark.asyncio
async def test_missing_idempotency_header_returns_stable_400(monkeypatch):
    loader = AsyncMock()
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )

    response = await _post(_app(loader), key=None)

    assert response.status_code == 400
    assert response.json()["code"] == "idempotency_key_required"
    loader.load.assert_not_awaited()


@pytest.mark.asyncio
async def test_first_load_returns_201_and_normalized_command(monkeypatch):
    loader = AsyncMock()
    result = _result()
    loader.load.return_value = result
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )

    response = await _post(_app(loader), key="  request-1  ")

    assert response.status_code == 201
    assert response.json() == result.model_dump(mode="json")
    command = loader.load.await_args.kwargs["command"]
    assert command.request_key == "request-1"
    assert command.initial_message == "Configure the agent."


@pytest.mark.asyncio
async def test_replay_returns_200_with_same_ids(monkeypatch):
    loader = AsyncMock()
    result = _result(replayed=True)
    loader.load.return_value = result
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )

    response = await _post(_app(loader))

    assert response.status_code == 200
    assert response.json() == result.model_dump(mode="json")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "expected_status", "expected_code"),
    [
        (TemplateSourceNotFound("missing"), 404, "template_source_not_found"),
        (TemplateCreateConflict(), 409, "template_load_conflict"),
        (SessionInputIdempotencyConflict(), 409, "idempotency_key_reused"),
        (
            TemplatePackageInvalid("bad_manifest", "Malformed package."),
            422,
            "template_package_invalid",
        ),
        (
            SessionStartNotDurable(),
            503,
            "template_handoff_not_durable",
        ),
    ],
)
async def test_domain_failures_have_stable_transport_errors(
    monkeypatch, error, expected_status, expected_code
):
    loader = AsyncMock()
    loader.load.side_effect = error
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )

    response = await _post(_app(loader))

    assert response.status_code == expected_status
    assert response.json()["code"] == expected_code
    assert {"code", "message", "retryable", "details"} <= set(response.json())
    if response.json()["retryable"]:
        assert response.json()["next_step"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("connection_id", "connection-1"),
        ("secret_id", "secret-1"),
        ("connection", {"slug": "resolved"}),
        ("workflow_id", "00000000-0000-4000-8000-000000000001"),
        ("session_id", "session-1"),
        ("execution_id", "execution-1"),
        ("version", "1.0.0"),
        ("digest", "sha256:" + "1" * 64),
        ("path", "/tmp/package"),
        ("_ag", {"trusted": True}),
    ],
)
async def test_server_owned_transport_fields_are_rejected_before_loader(
    monkeypatch, key, value
):
    loader = AsyncMock()
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    body = deepcopy(_body())
    body[key] = value

    response = await _post(_app(loader), body=body)

    assert response.status_code == 422
    loader.load.assert_not_awaited()


def test_openapi_contains_one_load_operation():
    loader = AsyncMock()
    schema = _app(loader).openapi()

    operation = schema["paths"]["/api/agent-templates/load"]["post"]
    assert operation["operationId"] == "load_agent_template"
    assert {item["name"]: item["in"] for item in operation["parameters"]} == {
        "project_id": "query"
    }
    assert (
        sum(
            1
            for path in schema["paths"].values()
            for method in path.values()
            if isinstance(method, dict)
            and method.get("operationId") == "load_agent_template"
        )
        == 1
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "connection", [{"mode": "self_managed"}, {"mode": "agenta", "slug": "my-model"}]
)
async def test_model_connection_selection_reaches_loader(monkeypatch, connection):
    loader = AsyncMock()
    loader.load.return_value = _result()
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    body = _body()
    agent = body["base_revision"]["parameters"]["agent"]
    agent["llm"]["connection"] = connection
    body["base_revision"]["schemas"] = {
        "parameters": {
            "type": "object",
            "properties": {"agent": {"default": deepcopy(agent)}},
        }
    }
    response = await _post(_app(loader), body=body)
    assert response.status_code == 201, response.text
    command = loader.load.await_args.kwargs["command"]
    assert command.base_revision.parameters["agent"]["llm"]["connection"] == connection


@pytest.mark.asyncio
async def test_native_parameter_names_are_not_template_transport_fields(monkeypatch):
    loader = AsyncMock()
    loader.load.return_value = _result()
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    body = _body()
    agent = body["base_revision"]["parameters"]["agent"]
    agent["skills"] = [
        {"name": "sample", "files": [{"path": "SKILL.md", "content": "Instructions"}]}
    ]
    agent["tools"] = [{"type": "reference", "version": "1"}]
    agent["mcps"] = [{"connection": {"slug": "existing"}}]
    agent["sandbox"] = {"credentials": {"mode": "configured"}}
    response = await _post(_app(loader), body=body)
    assert response.status_code == 201
    assert (
        loader.load.await_args.kwargs["command"].base_revision.parameters["agent"]
        == agent
    )


@pytest.mark.asyncio
async def test_internal_path_error_is_not_exposed(monkeypatch):
    from oss.src.core.mounts.types import MountPathInvalid

    loader = AsyncMock()
    loader.load.side_effect = MountPathInvalid("Traceback: /private/token-value")
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    response = await _post(_app(loader))
    assert response.status_code == 422
    assert "private" not in response.text
    assert "token-value" not in response.text
    assert (
        response.json()["message"] == "The template contains an invalid workspace path."
    )


def _validation_app(validator, loader=None):
    app = FastAPI()

    @app.middleware("http")
    async def add_state(request: Request, call_next):
        request.state.project_id = str(PROJECT_ID)
        request.state.user_id = str(USER_ID)
        return await call_next(request)

    app.include_router(
        AgentTemplatesRouter(loader=loader or AsyncMock(), validator=validator).router,
        prefix="/api/agent-templates",
    )
    return app


async def _validate(app, body, *, project_id=PROJECT_ID):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        return await client.post(
            f"/api/agent-templates/validate?project_id={project_id}",
            json=body,
        )


_SESSION_FILE = {
    "kind": "session_file",
    "session_id": "chat-session",
    "path": "templates/seo.zip",
}


@pytest.mark.asyncio
async def test_validate_returns_result_and_never_calls_the_loader(monkeypatch):
    validator = AsyncMock()
    validator.validate.return_value = TemplateValidationResult(
        valid=False,
        supported_schema_versions=["ai.agenta/1"],
        issues=[
            TemplateValidationIssue(
                code="file_not_found",
                path="ai.agenta/agents.json",
                field="agents.seo.setup",
                message="The declared file SETUP.md does not exist.",
                next_step="Create it.",
            )
        ],
    )
    loader = AsyncMock()
    access = AsyncMock(return_value=True)
    monkeypatch.setattr(router_module, "check_action_access", access)

    response = await _validate(
        _validation_app(validator, loader), {"source": _SESSION_FILE}
    )

    assert response.status_code == 200
    assert response.json()["issues"][0]["field"] == "agents.seo.setup"
    loader.load.assert_not_awaited()
    source = validator.validate.await_args.kwargs["source"]
    assert source.kind == "session_file" and source.path == "templates/seo.zip"
    assert [call.kwargs["permission"] for call in access.await_args_list] == [
        Permission.VIEW_WORKFLOWS,
        Permission.VIEW_SESSIONS,
        Permission.VIEW_MOUNTS,
    ]


@pytest.mark.asyncio
async def test_validate_denies_without_session_file_access(monkeypatch):
    validator = AsyncMock()
    monkeypatch.setattr(
        router_module,
        "check_action_access",
        AsyncMock(side_effect=[True, True, False]),
    )

    response = await _validate(_validation_app(validator), {"source": _SESSION_FILE})

    assert response.status_code == 403
    validator.validate.assert_not_awaited()


@pytest.mark.asyncio
async def test_validate_refuses_another_project(monkeypatch):
    validator = AsyncMock()
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )

    response = await _validate(
        _validation_app(validator), {"source": _SESSION_FILE}, project_id=uuid4()
    )

    assert response.status_code == 403
    validator.validate.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "source",
    [
        {"kind": "session_file", "session_id": "s", "path": "a.zip", "extra": 1},
        {"kind": "server_path", "path": "/etc/passwd"},
        {"kind": "upload", "staging_session_id": "s", "attachment_id": "nope"},
        {"kind": "directory", "path": "templates/seo"},
    ],
)
async def test_validate_rejects_unknown_or_host_path_sources(monkeypatch, source):
    validator = AsyncMock()
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )

    response = await _validate(_validation_app(validator), {"source": source})

    assert response.status_code == 422
    validator.validate.assert_not_awaited()


@pytest.mark.asyncio
async def test_validate_missing_source_is_a_normal_404(monkeypatch):
    validator = AsyncMock()
    validator.validate.side_effect = TemplateSourceNotFound("session_file:a.zip")
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )

    response = await _validate(_validation_app(validator), {"source": _SESSION_FILE})

    assert response.status_code == 404
    assert response.json()["code"] == "template_source_not_found"


@pytest.mark.asyncio
async def test_archive_load_checks_session_access_and_keeps_source(monkeypatch):
    loader = AsyncMock()
    loader.load.return_value = _result()
    access = AsyncMock(return_value=True)
    monkeypatch.setattr(router_module, "check_action_access", access)
    body = _body()
    body["source"] = {
        **_SESSION_FILE,
        "pin": {"version": "1.0.0", "digest": "sha256:" + "a" * 64},
    }

    response = await _post(_app(loader), body=body)

    assert response.status_code == 201
    assert [call.kwargs["permission"] for call in access.await_args_list] == [
        Permission.EDIT_WORKFLOWS,
        Permission.RUN_SESSIONS,
        Permission.VIEW_SESSIONS,
        Permission.VIEW_MOUNTS,
    ]
    command = loader.load.await_args.kwargs["command"]
    assert command.source.pin.version == "1.0.0"


@pytest.mark.asyncio
async def test_internal_source_without_kind_still_loads(monkeypatch):
    loader = AsyncMock()
    loader.load.return_value = _result()
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    body = _body()
    body["source"] = {"key": "outbound-prospecting"}

    response = await _post(_app(loader), body=body)

    assert response.status_code == 201
    assert loader.load.await_args.kwargs["command"].source.kind == "internal"
