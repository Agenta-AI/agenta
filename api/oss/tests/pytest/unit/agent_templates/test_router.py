from copy import deepcopy
from pathlib import Path
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient

from oss.src.apis.fastapi.agent_templates import router as router_module
from oss.src.apis.fastapi.agent_templates.router import AgentTemplatesRouter
from oss.src.core.agent_templates.catalog import AgentTemplateCatalog
from oss.src.core.access.permissions.types import Permission
from oss.src.core.agent_templates.dtos import TemplateLoadResult
from oss.src.core.agent_templates.exceptions import (
    TemplateCreateConflict,
    TemplatePackageInvalid,
    TemplateSourceNotFound,
)
from oss.src.core.sessions.inputs.types import SessionInputIdempotencyConflict
from oss.src.core.sessions.starts.types import SessionStartNotDurable


CATALOG = AgentTemplateCatalog(
    catalog_path=Path(__file__).resolve().parents[4]
    / "src"
    / "resources"
    / "agent_templates"
    / "catalog.json"
)
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


def _app(loader, catalog=CATALOG):
    app = FastAPI()

    @app.middleware("http")
    async def add_state(request: Request, call_next):
        request.state.project_id = str(PROJECT_ID)
        request.state.user_id = str(USER_ID)
        return await call_next(request)

    app.include_router(
        AgentTemplatesRouter(loader=loader, catalog=catalog).router,
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


async def _request(app, method, path, **kwargs):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        return await client.request(
            method, f"/api/agent-templates{path}?project_id={PROJECT_ID}", **kwargs
        )


@pytest.mark.asyncio
async def test_query_returns_every_listed_template_in_catalog_order(monkeypatch):
    access = AsyncMock(return_value=True)
    monkeypatch.setattr(router_module, "check_action_access", access)

    response = await _request(_app(AsyncMock()), "POST", "/query", json={})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == len(body["templates"]) == 28
    assert [item["key"] for item in body["templates"]] == [
        entry.key for entry in CATALOG.entries()
    ]
    first = body["templates"][0]
    assert first["author"]["id"] == "agenta"
    assert first["source"] == {"kind": "internal", "key": "pr-reviewer"}
    assert first["tools_summary"] == "3 GitHub tools"
    assert access.await_args.kwargs["permission"] == Permission.VIEW_WORKFLOWS


@pytest.mark.asyncio
async def test_query_accepts_an_empty_body_and_filters(monkeypatch):
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    app = _app(AsyncMock())

    empty = await _request(app, "POST", "/query")
    filtered = await _request(
        app, "POST", "/query", json={"category": "Support", "search": "zendesk"}
    )

    assert empty.status_code == 200
    assert empty.json()["count"] == 28
    assert [item["key"] for item in filtered.json()["templates"]] == [
        "support-reply-drafter"
    ]


@pytest.mark.asyncio
async def test_query_rejects_unknown_filters(monkeypatch):
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )

    response = await _request(_app(AsyncMock()), "POST", "/query", json={"page": 2})

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_catalog_reads_require_view_permission(monkeypatch):
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=False)
    )
    app = _app(AsyncMock())

    assert (await _request(app, "POST", "/query", json={})).status_code == 403
    assert (await _request(app, "GET", "/pr-reviewer")).status_code == 403


@pytest.mark.asyncio
async def test_fetch_returns_detail_and_selected_version(monkeypatch):
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    app = _app(AsyncMock())

    latest = await _request(app, "GET", "/pr-reviewer")
    pinned = await _request(app, "GET", "/pr-reviewer", params={"version": "1.0.0"})

    assert latest.status_code == 200, latest.text
    assert latest.json()["template"]["version"] == "1.0.0"
    assert latest.json()["template"]["connections"][0]["alternatives"] == ["gitlab"]
    assert pinned.json() == latest.json()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("path", "params"),
    [
        ("/missing-template", None),
        ("/pr-reviewer", {"version": "9.9.9"}),
        ("/outbound-prospecting", None),
    ],
)
async def test_fetch_unknown_key_or_version_is_404(monkeypatch, path, params):
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )

    response = await _request(_app(AsyncMock()), "GET", path, params=params)

    assert response.status_code == 404
    assert response.json()["code"] == "template_source_not_found"


def test_openapi_registers_query_before_detail():
    paths = list(_app(AsyncMock()).openapi()["paths"])

    assert paths.index("/api/agent-templates/query") < paths.index(
        "/api/agent-templates/{key}"
    )
