from copy import deepcopy
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient

from oss.src.apis.fastapi.agent_templates import router as router_module
from oss.src.apis.fastapi.agent_templates.router import AgentTemplatesRouter
from oss.src.core.access.permissions.types import Permission
from oss.src.core.agent_templates.dtos import TemplateLoadResult
from oss.src.core.agent_templates.exceptions import (
    TemplateCreateConflict,
    TemplatePackageInvalid,
    TemplateSourceNotFound,
)
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
    assert set(response.json()) == {"code", "message", "retryable", "details"}


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
@pytest.mark.parametrize("target", ["tools", "mcps", "model_secret", "model_nested"])
async def test_nested_server_owned_bindings_remain_rejected(monkeypatch, target):
    loader = AsyncMock()
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    body = _body()
    agent = body["base_revision"]["parameters"]["agent"]
    if target == "model_secret":
        agent["llm"]["connection"] = {"mode": "agenta", "secret_id": "forged"}
    elif target == "model_nested":
        agent["llm"]["connection"] = {
            "mode": "agenta",
            "connection": {"slug": "forged"},
        }
    else:
        agent[target] = [{"connection": {"slug": "forged"}}]
    response = await _post(_app(loader), body=body)
    assert response.status_code == 422
    loader.load.assert_not_awaited()
