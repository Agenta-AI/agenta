"""The ``gateway_toolkit`` tools: server-side resolution + the ``/tools/call`` branch.

A ``gateway_toolkit`` config resolves server-side into two callback specs whose call_refs are
``toolkit.{provider}.{connection_id}.search`` and
``toolkit.{provider}.{connection_id}.run.{policy}`` — keyed on the connection id, with the
policy's Agenta action keys mapped to Composio slugs. When the model calls one, the runner
POSTs the OpenAI tool-call envelope to ``/tools/call``; the router routes the ``toolkit.``
prefix to ``_call_toolkit_tool``. These tests exercise resolution, the call_ref grammar, the
policy check, and the handler with a fake ToolsService (no DB, no live Composio).
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from agenta.sdk.agents.tools import GatewayToolkitConfig, ToolkitPolicy

from oss.src.apis.fastapi.tools.router import (
    ToolsRouter,
    _parse_toolkit_call_ref,
    _toolkit_run_allows,
)
from oss.src.core.tools.dtos import (
    ToolCall,
    ToolCallData,
    ToolCallFunction,
    ToolExecutionResponse,
)
from oss.src.core.tools.service import ToolsService

_CID = "11111111-1111-1111-1111-111111111111"


# ---------------------------------------------------------------------------
# Server-side resolution: one config -> two specs keyed on the connection id
# ---------------------------------------------------------------------------


async def test_resolve_toolkit_tool_builds_two_specs_keyed_on_connection_id():
    service = ToolsService.__new__(ToolsService)

    async def _fake_resolve(**_kwargs):
        return SimpleNamespace(id=UUID(_CID))

    service.resolve_connection_by_slug = _fake_resolve  # type: ignore[method-assign]

    config = GatewayToolkitConfig(
        integration="github",
        connection="github-main",
        tools=ToolkitPolicy(mode="include", actions=["CREATE_AN_ISSUE", "GET_ISSUE"]),
        permission="ask",
    )
    specs = await service._resolve_toolkit_tool(project_id=uuid4(), ref=config)

    assert len(specs) == 2
    search, run = specs
    assert search.call_ref == f"toolkit.composio.{_CID}.search"
    assert search.read_only is True
    assert search.permission == "ask"
    # Agenta action keys -> Composio slugs, encoded on the run call_ref and offered as an enum.
    assert run.call_ref == (
        f"toolkit.composio.{_CID}.run.include.GITHUB_CREATE_AN_ISSUE.GITHUB_GET_ISSUE"
    )
    assert run.input_schema["properties"]["action"]["enum"] == [
        "GITHUB_CREATE_AN_ISSUE",
        "GITHUB_GET_ISSUE",
    ]
    assert run.permission == "ask"


async def test_resolve_toolkit_tool_all_policy_has_no_slug_list():
    service = ToolsService.__new__(ToolsService)

    async def _fake_resolve(**_kwargs):
        return SimpleNamespace(id=UUID(_CID))

    service.resolve_connection_by_slug = _fake_resolve  # type: ignore[method-assign]

    config = GatewayToolkitConfig(integration="slack", connection="slack-main")
    _search, run = await service._resolve_toolkit_tool(project_id=uuid4(), ref=config)
    assert run.call_ref == f"toolkit.composio.{_CID}.run.all"
    assert "enum" not in run.input_schema["properties"]["action"]


# ---------------------------------------------------------------------------
# call_ref grammar + policy helper (pure)
# ---------------------------------------------------------------------------


def test_parse_search_call_ref():
    ref = _parse_toolkit_call_ref(f"toolkit.composio.{_CID}.search")
    assert ref.kind == "search"
    assert ref.provider == "composio"
    assert ref.connection_id == _CID


def test_parse_run_all_call_ref():
    ref = _parse_toolkit_call_ref(f"toolkit.composio.{_CID}.run.all")
    assert ref.kind == "run"
    assert ref.mode == "all"
    assert ref.allowed is None


def test_parse_run_include_call_ref():
    ref = _parse_toolkit_call_ref(
        f"toolkit.composio.{_CID}.run.include.GITHUB_CREATE_AN_ISSUE.GITHUB_GET_ISSUE"
    )
    assert ref.kind == "run"
    assert ref.mode == "include"
    assert ref.allowed == ["GITHUB_CREATE_AN_ISSUE", "GITHUB_GET_ISSUE"]


@pytest.mark.parametrize(
    "call_ref",
    [
        "toolkit.composio",  # too short
        "workflow.variant.x",  # wrong prefix
        "toolkit.composio.not-a-uuid.search",  # bad connection id
        f"toolkit.composio.{_CID}.run.include",  # include with no actions
        f"toolkit.composio.{_CID}.run.bogus",  # unknown mode
        f"toolkit.composio.{_CID}.jump",  # unknown kind
    ],
)
def test_parse_rejects_malformed_call_refs(call_ref):
    with pytest.raises(ValueError):
        _parse_toolkit_call_ref(call_ref)


def test_run_policy_allows():
    all_ref = _parse_toolkit_call_ref(f"toolkit.composio.{_CID}.run.all")
    assert _toolkit_run_allows(all_ref, "SLACK_ANYTHING") is True

    include_ref = _parse_toolkit_call_ref(
        f"toolkit.composio.{_CID}.run.include.GITHUB_GET_ISSUE"
    )
    assert _toolkit_run_allows(include_ref, "GITHUB_GET_ISSUE") is True
    assert (
        _toolkit_run_allows(include_ref, "github_get_issue") is True
    )  # case-insensitive
    assert _toolkit_run_allows(include_ref, "GITHUB_CREATE_AN_ISSUE") is False


# ---------------------------------------------------------------------------
# _call_toolkit_tool with a fake ToolsService
# ---------------------------------------------------------------------------


class FakeToolsService:
    """Records calls; returns canned connection + search + execute results."""

    def __init__(self, *, execute_response=None):
        self._execute_response = execute_response or ToolExecutionResponse(
            data={"login": "octocat"}, successful=True
        )
        self.searched: list[dict] = []
        self.executed: list[dict] = []

    async def resolve_connection_by_id(self, *, project_id, connection_id):
        return SimpleNamespace(
            integration_key="github",
            provider_connection_id="ca_123",
            data={"project_id": str(project_id)},
        )

    async def search_toolkit_actions(
        self, *, project_id, provider_key, integration_key, query
    ):
        self.searched.append({"integration": integration_key, "query": query})
        return [
            {
                "slug": "GITHUB_CREATE_AN_ISSUE",
                "description": "Create an issue",
                "input_schema": {"type": "object"},
            }
        ]

    async def execute_toolkit_action(
        self, *, provider_key, tool_slug, provider_connection_id, user_id, arguments
    ):
        self.executed.append(
            {
                "tool_slug": tool_slug,
                "provider_connection_id": provider_connection_id,
                "user_id": user_id,
                "arguments": arguments,
            }
        )
        return self._execute_response


def _router(tools_service):
    return ToolsRouter(tools_service=tools_service)


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(project_id=str(uuid4()), user_id=str(uuid4())),
        headers={},
    )


def _call(name: str, arguments) -> ToolCall:
    return ToolCall(
        data=ToolCallData(
            id="call_1",
            function=ToolCallFunction(name=name, arguments=arguments),
        )
    )


async def test_search_returns_actions():
    tools = FakeToolsService()
    response = await _router(tools)._call_toolkit_tool(
        request=_request(),
        body=_call(f"toolkit.composio.{_CID}.search", {"query": "create an issue"}),
    )
    # Integration comes from the resolved connection row, not the call_ref.
    assert tools.searched == [{"integration": "github", "query": "create an issue"}]
    result = response.call
    assert result.status.code == "STATUS_CODE_OK"
    payload = json.loads(result.data.content)
    assert payload["actions"][0]["slug"] == "GITHUB_CREATE_AN_ISSUE"


async def test_run_executes_allowed_action():
    tools = FakeToolsService()
    request = _request()
    response = await _router(tools)._call_toolkit_tool(
        request=request,
        body=_call(
            f"toolkit.composio.{_CID}.run.include.GITHUB_GET_THE_AUTHENTICATED_USER",
            {"action": "GITHUB_GET_THE_AUTHENTICATED_USER", "arguments": {}},
        ),
    )
    # The allowed slug ran, pinned to the connection's account and stored project user_id.
    assert len(tools.executed) == 1
    assert tools.executed[0]["tool_slug"] == "GITHUB_GET_THE_AUTHENTICATED_USER"
    assert tools.executed[0]["provider_connection_id"] == "ca_123"
    assert tools.executed[0]["user_id"] == request.state.project_id
    assert response.call.status.code == "STATUS_CODE_OK"


async def test_run_rejects_disallowed_action_without_executing():
    tools = FakeToolsService()
    response = await _router(tools)._call_toolkit_tool(
        request=_request(),
        body=_call(
            f"toolkit.composio.{_CID}.run.include.GITHUB_GET_ISSUE",
            {"action": "GITHUB_CREATE_AN_ISSUE", "arguments": {"title": "x"}},
        ),
    )
    # Policy rejects before any Composio call.
    assert tools.executed == []
    result = response.call
    assert result.status.code == "STATUS_CODE_ERROR"
    assert "not allowed" in result.status.message
    assert "GITHUB_CREATE_AN_ISSUE" in result.status.message


async def test_run_without_action_returns_soft_error():
    tools = FakeToolsService()
    response = await _router(tools)._call_toolkit_tool(
        request=_request(),
        body=_call(f"toolkit.composio.{_CID}.run.all", {"arguments": {}}),
    )
    assert tools.executed == []
    assert response.call.status.code == "STATUS_CODE_ERROR"
