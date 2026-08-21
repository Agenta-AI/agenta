"""The ``/tools/call`` branch for ``gateway_toolkit`` tools (one connection → search + run).

A ``gateway_toolkit`` config resolves (SDK-side) into two callback specs whose call_refs are
``toolkit.{provider}.{integration}.{connection}.search`` and
``toolkit.{provider}.{integration}.{connection}.run.{policy}``. When the model calls one, the
runner POSTs the OpenAI tool-call envelope to ``/tools/call``; the router routes the
``toolkit.`` prefix to ``_call_toolkit_tool``. These tests exercise the call_ref grammar, the
policy check, and the handler with a fake ToolsService (no DB, no live Composio).
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import uuid4

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


# ---------------------------------------------------------------------------
# call_ref grammar + policy helper (pure)
# ---------------------------------------------------------------------------


def test_parse_search_call_ref():
    ref = _parse_toolkit_call_ref("toolkit.composio.github.github-main.search")
    assert ref.kind == "search"
    assert ref.provider == "composio"
    assert ref.integration == "github"
    assert ref.connection == "github-main"


def test_parse_run_all_call_ref():
    ref = _parse_toolkit_call_ref("toolkit.composio.slack.slack-main.run.all")
    assert ref.kind == "run"
    assert ref.mode == "all"
    assert ref.allowed is None


def test_parse_run_include_call_ref():
    ref = _parse_toolkit_call_ref(
        "toolkit.composio.github.github-main.run.include."
        "GITHUB_CREATE_AN_ISSUE.GITHUB_GET_ISSUE"
    )
    assert ref.kind == "run"
    assert ref.mode == "include"
    assert ref.allowed == ["GITHUB_CREATE_AN_ISSUE", "GITHUB_GET_ISSUE"]


@pytest.mark.parametrize(
    "call_ref",
    [
        "toolkit.composio.github",  # too short
        "workflow.variant.x",  # wrong prefix
        "toolkit.composio.github.github-main.run.include",  # include with no actions
        "toolkit.composio.github.github-main.run.bogus",  # unknown mode
        "toolkit.composio.github.github-main.jump",  # unknown kind
        "toolkit.composio.gi thub.c.search",  # bad segment
    ],
)
def test_parse_rejects_malformed_call_refs(call_ref):
    with pytest.raises(ValueError):
        _parse_toolkit_call_ref(call_ref)


def test_run_policy_allows():
    all_ref = _parse_toolkit_call_ref("toolkit.composio.slack.slack-main.run.all")
    assert _toolkit_run_allows(all_ref, "SLACK_ANYTHING") is True

    include_ref = _parse_toolkit_call_ref(
        "toolkit.composio.github.github-main.run.include.GITHUB_GET_ISSUE"
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

    async def resolve_connection_by_slug(
        self, *, project_id, provider_key, integration_key, connection_slug
    ):
        return SimpleNamespace(
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
        body=_call(
            "toolkit.composio.github.github-main.search", {"query": "create an issue"}
        ),
    )
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
            "toolkit.composio.github.github-main.run.include.GITHUB_GET_THE_AUTHENTICATED_USER",
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
            "toolkit.composio.github.github-main.run.include.GITHUB_GET_ISSUE",
            {"action": "GITHUB_CREATE_AN_ISSUE", "arguments": {"title": "x"}},
        ),
    )
    # Policy rejects before any Composio call.
    assert tools.executed == []
    result = response.call
    assert result.status.code == "STATUS_CODE_ERROR"
    assert "not allowed" in result.status.message
    assert "GITHUB_CREATE_AN_ISSUE" in result.status.message


async def test_short_action_keys_map_to_slugs_and_enforce_end_to_end():
    # The config stores SHORT Agenta action keys; the SDK maps them to Composio slugs in the
    # run call_ref, and /tools/call enforces against those slugs. Allow ["GET_PROFILE"] on a
    # gmail connection, then a run of GMAIL_SEND_EMAIL must be rejected and GMAIL_GET_PROFILE
    # allowed.
    config = GatewayToolkitConfig(
        integration="gmail",
        connection="gmail-main",
        tools=ToolkitPolicy(mode="include", actions=["GET_PROFILE"]),
    )
    assert config.run_call_ref.endswith(".run.include.GMAIL_GET_PROFILE")

    tools = FakeToolsService()
    rejected = await _router(tools)._call_toolkit_tool(
        request=_request(),
        body=_call(
            config.run_call_ref, {"action": "GMAIL_SEND_EMAIL", "arguments": {}}
        ),
    )
    assert tools.executed == []
    assert rejected.call.status.code == "STATUS_CODE_ERROR"
    assert "GMAIL_SEND_EMAIL" in rejected.call.status.message

    allowed = await _router(tools)._call_toolkit_tool(
        request=_request(),
        body=_call(
            config.run_call_ref, {"action": "GMAIL_GET_PROFILE", "arguments": {}}
        ),
    )
    assert [e["tool_slug"] for e in tools.executed] == ["GMAIL_GET_PROFILE"]
    assert allowed.call.status.code == "STATUS_CODE_OK"


async def test_run_without_action_returns_soft_error():
    tools = FakeToolsService()
    response = await _router(tools)._call_toolkit_tool(
        request=_request(),
        body=_call("toolkit.composio.github.github-main.run.all", {"arguments": {}}),
    )
    assert tools.executed == []
    assert response.call.status.code == "STATUS_CODE_ERROR"
