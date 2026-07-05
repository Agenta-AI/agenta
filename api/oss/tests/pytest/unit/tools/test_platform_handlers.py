from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from agenta.sdk.contexts.running import RunningContext, running_context_manager
from agenta.sdk.contexts.tracing import TracingContext, tracing_context_manager
from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
from agenta.sdk.models.workflows import WorkflowInvokeRequest
from agenta.sdk.utils.types import build_agent_v0_default
from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.core.access.permissions.types import Permission
from oss.src.core.tools.dtos import ToolCall, ToolCallData, ToolCallFunction
from oss.src.core.tools.platform_handlers import (
    TEST_RUN_RECURSION_HEADER,
    TEST_RUN_RECURSION_VALUE,
    PlatformToolHandlerRefused,
    handle_test_run,
)
from oss.src.core.workflows.dtos import WorkflowRevisionData, WorkflowServiceRequestData
from oss.src.core.workflows.service import WorkflowsService


_MISSING = object()
_DEFAULT_REVISION_DATA = {
    "url": "https://agent.internal",
    "parameters": {"agent": {"model": "base"}},
}


class FakeWorkflowsService:
    _coerce_invoke_response = staticmethod(WorkflowsService._coerce_invoke_response)

    def __init__(
        self,
        *,
        service_url="https://agent.internal",
        delta_data=None,
        revision_data=_MISSING,
    ):
        self.service_url = service_url
        self.delta_data = (
            delta_data if delta_data is not None else _DEFAULT_REVISION_DATA
        )
        self.revision_data = (
            _DEFAULT_REVISION_DATA if revision_data is _MISSING else revision_data
        )
        self.ensure_calls = []
        self.delta_calls = []
        self.prepare_calls = []

    async def _ensure_request_revision(self, *, project_id, request):
        self.ensure_calls.append({"project_id": project_id, "request": request})
        if self.revision_data is None:
            return
        if request.data is None:
            request.data = WorkflowServiceRequestData()
        request.data.revision = {"data": self.revision_data}

    async def _resolve_revision_delta(self, *, project_id, workflow_revision_commit):
        self.delta_calls.append(
            {"project_id": project_id, "commit": workflow_revision_commit}
        )
        return SimpleNamespace(data=WorkflowRevisionData(**self.delta_data))

    async def _prepare_invoke(self, *, project_id, user_id, request):
        self.prepare_calls.append(
            {"project_id": project_id, "user_id": user_id, "request": request}
        )
        return "Secret signed", self.service_url


class FakeTracingService:
    def __init__(self, *responses):
        self.responses = list(responses) or [[]]
        self.calls = []

    async def query_spans(self, *, project_id, query):
        self.calls.append({"project_id": project_id, "query": query})
        if len(self.responses) > 1:
            return self.responses.pop(0)
        return self.responses[0]


class HttpxController:
    def __init__(self, monkeypatch, *, response=None, raises=None):
        self.response = response or httpx.Response(
            200,
            json={"data": {"outputs": {"messages": []}}},
            headers={"x-ag-trace-id": "trace-1"},
        )
        self.raises = raises
        self.calls = []
        self.client_kwargs = []

        controller = self

        class FakeAsyncClient:
            def __init__(self, **kwargs):
                controller.client_kwargs.append(kwargs)

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def post(self, url, *, json=None, headers=None):
                controller.calls.append({"url": url, "json": json, "headers": headers})
                if controller.raises is not None:
                    raise controller.raises
                return controller.response

        monkeypatch.setattr(
            "oss.src.core.tools.platform_handlers.httpx.AsyncClient",
            FakeAsyncClient,
        )


def _args(*, terminal_tool="slack__SEND_MESSAGE", delta=None):
    data = {
        "target": {"workflow_variant_id": str(uuid4())},
        "inputs": {"messages": [{"role": "user", "content": "Say hi"}]},
        "expectations": {"terminal_tool": terminal_tool},
    }
    if delta is not None:
        data["delta"] = delta
    return data


def _response(outputs, *, trace_id="trace-1", status=200):
    return httpx.Response(
        status,
        json={"data": {"outputs": outputs}},
        headers={"x-ag-trace-id": trace_id},
    )


def _span(name, *, returned=True, error=False, resolved=None):
    attrs = {"ag": {"data": {"outputs": {"ok": True} if returned else None}}}
    if resolved is not None:
        attrs["ag"]["meta"] = {"resolved": resolved}
    return SimpleNamespace(
        span_name=name,
        span_type="tool",
        status_code="STATUS_CODE_ERROR" if error else "STATUS_CODE_OK",
        attributes=attrs,
    )


async def _run(monkeypatch, *, outputs, args=None, tracing=None, raises=None):
    http = HttpxController(
        monkeypatch,
        response=_response(outputs),
        raises=raises,
    )
    workflows = FakeWorkflowsService()
    result = await handle_test_run(
        arguments=args or _args(),
        headers={},
        project_id=uuid4(),
        user_id=uuid4(),
        workflows_service=workflows,
        tracing_service=tracing or FakeTracingService(),
    )
    return result, workflows, http


async def test_test_run_happy_path_invokes_child_and_returns_digest(monkeypatch):
    outputs = {
        "messages": [
            {"role": "assistant", "content": "checking"},
            {
                "role": "tool",
                "content": "",
                "tool_call_id": "call_1",
                "tool_name": "github__LIST_COMMITS",
                "input": {"repo": "agenta"},
            },
            {"role": "tool", "content": "[]", "tool_call_id": "call_1"},
            {
                "role": "tool",
                "content": "",
                "tool_call_id": "call_2",
                "tool_name": "slack__SEND_MESSAGE",
                "input": {"text": "hi"},
            },
            {"role": "tool", "content": "ok", "tool_call_id": "call_2"},
            {"role": "assistant", "content": "sent"},
        ],
        "stop_reason": "stop",
    }
    tracing = FakeTracingService(
        [
            _span(
                "slack__SEND_MESSAGE",
                resolved={
                    "harness": "claude",
                    "model": "sonnet",
                    "provider": "anthropic",
                    "connection_mode": "self_managed",
                },
            )
        ]
    )

    result, workflows, http = await _run(monkeypatch, outputs=outputs, tracing=tracing)

    assert result.verdict == "pass"
    assert result.output == "sent"
    assert [tool.name for tool in result.tools] == [
        "github__LIST_COMMITS",
        "slack__SEND_MESSAGE",
    ]
    assert all(tool.returned for tool in result.tools)
    assert result.resolved.harness == "claude"
    assert result.resolved.connection_mode == "self_managed"
    assert result.trace_id == "trace-1"

    payload = http.calls[0]["json"]
    assert payload["meta"]["run_kind"] == "test"
    assert payload["data"]["inputs"] == {
        "messages": [{"role": "user", "content": "Say hi"}]
    }
    assert workflows.ensure_calls
    assert workflows.prepare_calls


async def test_test_run_parameters_less_agent_revision_succeeds_with_resolver_backed_child(
    monkeypatch,
):
    expected_parameters = {"agent": build_agent_v0_default()}
    http_calls = []
    monkeypatch.setattr(
        "agenta.sdk.middlewares.running.resolver.ag.async_api",
        None,
        raising=False,
    )

    class ResolverBackedAsyncClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, *, json=None, headers=None):
            http_calls.append({"url": url, "json": json, "headers": headers})
            request = WorkflowInvokeRequest.model_validate(json)

            async def _noop_call_next(_request):
                return None

            with (
                running_context_manager(RunningContext()),
                tracing_context_manager(TracingContext()),
            ):
                await ResolverMiddleware()(request, _noop_call_next)

            if request.data.parameters != expected_parameters:
                return httpx.Response(
                    500,
                    json={
                        "status": {
                            "message": (
                                "pi_core: model authentication failed "
                                "(resolved model=<none> provider=<none>)"
                            )
                        }
                    },
                )

            return _response(
                {
                    "messages": [{"role": "assistant", "content": "pong"}],
                    "stop_reason": "stop",
                }
            )

    monkeypatch.setattr(
        "oss.src.core.tools.platform_handlers.httpx.AsyncClient",
        ResolverBackedAsyncClient,
    )
    workflows = FakeWorkflowsService(
        revision_data={
            "uri": "agenta:builtin:agent:v0",
            "url": "https://agent.internal",
            "schemas": {"parameters": {"type": "object"}},
        }
    )

    result = await handle_test_run(
        arguments=_args(terminal_tool=None),
        headers={},
        project_id=uuid4(),
        user_id=uuid4(),
        workflows_service=workflows,
        tracing_service=FakeTracingService(),
    )

    assert result.verdict == "unconfirmed"
    assert result.output == "pong"
    revision = http_calls[0]["json"]["data"]["revision"]["data"]
    assert "parameters" not in revision
    assert workflows.ensure_calls
    assert workflows.prepare_calls


async def test_test_run_applies_delta_in_memory(monkeypatch):
    outputs = {"messages": [{"role": "assistant", "content": "ok"}]}
    http = HttpxController(monkeypatch, response=_response(outputs))
    workflows = FakeWorkflowsService(
        delta_data={
            "url": "https://agent.internal",
            "parameters": {"agent": {"model": "changed"}},
        }
    )

    result = await handle_test_run(
        arguments=_args(
            terminal_tool=None,
            delta={
                "set": {"parameters": {"agent": {"model": "changed"}}},
                "remove": ["parameters.agent.old"],
            },
        ),
        headers={},
        project_id=uuid4(),
        user_id=uuid4(),
        workflows_service=workflows,
        tracing_service=FakeTracingService(),
    )

    assert result.verdict == "unconfirmed"
    assert workflows.ensure_calls
    assert workflows.delta_calls
    revision = http.calls[0]["json"]["data"]["revision"]["data"]
    assert revision["parameters"]["agent"]["model"] == "changed"


async def test_test_run_delta_requires_existing_project_scoped_variant(monkeypatch):
    async def _allow(**_kwargs):
        return True

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.check_action_access", _allow)
    http = HttpxController(monkeypatch)
    workflows = FakeWorkflowsService(revision_data=None)
    router = ToolsRouter(
        tools_service=SimpleNamespace(),
        workflows_service=workflows,
        tracing_service=FakeTracingService(),
    )
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=str(uuid4()), user_id=str(uuid4())),
        headers={},
    )
    body = ToolCall(
        data=ToolCallData(
            id="outer_call",
            function=ToolCallFunction(
                name="tools.agenta.test_run",
                arguments=_args(delta={"set": {"url": "https://evil.example"}}),
            ),
        )
    )

    with pytest.raises(HTTPException) as exc_info:
        await router.call_tool(request, body=body)

    assert exc_info.value.status_code == 400
    assert "target workflow variant revision" in exc_info.value.detail
    assert workflows.ensure_calls
    assert not workflows.delta_calls
    assert not workflows.prepare_calls
    assert http.calls == []


async def test_test_run_delta_requires_edit_workflows_permission(monkeypatch):
    seen_permissions = []

    async def _run_tools_only(*, permission, **_kwargs):
        seen_permissions.append(permission)
        return permission == Permission.RUN_TOOLS

    monkeypatch.setattr(
        "oss.src.apis.fastapi.tools.router.check_action_access",
        _run_tools_only,
    )
    http = HttpxController(monkeypatch)
    workflows = FakeWorkflowsService()
    router = ToolsRouter(
        tools_service=SimpleNamespace(),
        workflows_service=workflows,
        tracing_service=FakeTracingService(),
    )
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=str(uuid4()), user_id=str(uuid4())),
        headers={},
    )
    body = ToolCall(
        data=ToolCallData(
            id="outer_call",
            function=ToolCallFunction(
                name="tools.agenta.test_run",
                arguments=_args(
                    delta={"set": {"parameters": {"agent": {"model": "changed"}}}}
                ),
            ),
        )
    )

    with pytest.raises(HTTPException) as exc_info:
        await router.call_tool(request, body=body)

    assert exc_info.value.status_code == 403
    assert seen_permissions == [Permission.RUN_TOOLS, Permission.EDIT_WORKFLOWS]
    assert not workflows.ensure_calls
    assert not workflows.delta_calls
    assert not workflows.prepare_calls
    assert http.calls == []


async def test_test_run_delta_with_edit_workflows_permission_invokes(monkeypatch):
    seen_permissions = []

    async def _allow(*, permission, **_kwargs):
        seen_permissions.append(permission)
        return True

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.check_action_access", _allow)
    http = HttpxController(
        monkeypatch,
        response=_response({"messages": [{"role": "assistant", "content": "ok"}]}),
    )
    workflows = FakeWorkflowsService(
        delta_data={
            "url": "https://agent.internal",
            "parameters": {"agent": {"model": "changed"}},
        }
    )
    router = ToolsRouter(
        tools_service=SimpleNamespace(),
        workflows_service=workflows,
        tracing_service=FakeTracingService(),
    )
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=str(uuid4()), user_id=str(uuid4())),
        headers={},
    )
    body = ToolCall(
        data=ToolCallData(
            id="outer_call",
            function=ToolCallFunction(
                name="tools.agenta.test_run",
                arguments=_args(
                    terminal_tool=None,
                    delta={"set": {"parameters": {"agent": {"model": "changed"}}}},
                ),
            ),
        )
    )

    response = await router.call_tool(request, body=body)

    content = json.loads(response.call.data.content)
    assert content["verdict"] == "unconfirmed"
    assert seen_permissions == [Permission.RUN_TOOLS, Permission.EDIT_WORKFLOWS]
    assert workflows.ensure_calls
    assert workflows.delta_calls
    assert workflows.prepare_calls
    assert len(http.calls) == 1


async def test_test_run_paused_interaction_returns_approval_and_unconfirmed(
    monkeypatch,
):
    outputs = {
        "messages": [
            {"role": "assistant", "content": "need approval"},
            {
                "role": "tool",
                "content": "",
                "tool_call_id": "call_1",
                "tool_name": "slack__SEND_MESSAGE",
            },
        ],
        "stop_reason": "paused",
        "pending_interaction": {
            "id": "perm_1",
            "payload": {
                "toolCall": {"toolCallId": "call_1", "name": "slack__SEND_MESSAGE"}
            },
        },
    }

    result, _, _ = await _run(monkeypatch, outputs=outputs)

    assert result.approvals == ["slack__SEND_MESSAGE"]
    assert result.verdict == "unconfirmed"
    assert "waiting for approval" in result.verdict_reason


async def test_test_run_terminal_tool_result_wins_over_later_pause(monkeypatch):
    outputs = {
        "messages": [
            {
                "role": "tool",
                "content": "",
                "tool_call_id": "call_1",
                "tool_name": "slack__SEND_MESSAGE",
            },
            {"role": "tool", "content": "ok", "tool_call_id": "call_1"},
        ],
        "stop_reason": "paused",
    }

    result, _, _ = await _run(monkeypatch, outputs=outputs)

    assert result.verdict == "pass"
    assert result.verdict_reason is None


async def test_test_run_terminal_tool_without_output_is_unconfirmed_when_not_paused(
    monkeypatch,
):
    outputs = {
        "messages": [
            {
                "role": "tool",
                "content": "",
                "tool_call_id": "call_1",
                "tool_name": "slack__SEND_MESSAGE",
            }
        ],
        "stop_reason": "stop",
    }

    result, _, _ = await _run(monkeypatch, outputs=outputs)

    assert result.verdict == "unconfirmed"
    assert "did not return output" in result.verdict_reason


async def test_test_run_tool_turn_ending_uses_last_assistant_output(monkeypatch):
    outputs = {
        "messages": [
            {"role": "assistant", "content": "about to send"},
            {
                "role": "tool",
                "content": "",
                "tool_call_id": "call_1",
                "tool_name": "slack__SEND_MESSAGE",
            },
            {"role": "tool", "content": "ok", "tool_call_id": "call_1"},
        ],
        "stop_reason": "stop",
    }

    result, _, _ = await _run(monkeypatch, outputs=outputs)

    assert result.output == "about to send"
    assert result.verdict == "pass"


async def test_test_run_terminal_tool_missing_is_incomplete(monkeypatch):
    outputs = {
        "messages": [
            {"role": "assistant", "content": "I stopped early"},
            {
                "role": "tool",
                "content": "",
                "tool_call_id": "call_1",
                "tool_name": "github__LIST_COMMITS",
            },
            {"role": "tool", "content": "[]", "tool_call_id": "call_1"},
        ],
        "stop_reason": "stop",
    }

    result, _, _ = await _run(monkeypatch, outputs=outputs)

    assert result.verdict == "incomplete"
    assert "slack__SEND_MESSAGE" in result.verdict_reason


async def test_test_run_recursion_marker_is_refused(monkeypatch):
    HttpxController(monkeypatch)

    with pytest.raises(PlatformToolHandlerRefused):
        await handle_test_run(
            arguments=_args(),
            headers={TEST_RUN_RECURSION_HEADER: TEST_RUN_RECURSION_VALUE},
            project_id=uuid4(),
            user_id=uuid4(),
            workflows_service=FakeWorkflowsService(),
            tracing_service=FakeTracingService(),
        )


async def test_test_run_timeout_returns_failed_verdict(monkeypatch):
    result, _, _ = await _run(
        monkeypatch,
        outputs={"messages": []},
        raises=httpx.ReadTimeout("too slow"),
    )

    assert result.verdict == "failed"
    assert "timed out" in result.verdict_reason


async def test_test_run_retries_spans_for_returned_confirmation(monkeypatch):
    outputs = {
        "messages": [
            {
                "role": "tool",
                "content": "",
                "tool_call_id": "call_1",
                "tool_name": "slack__SEND_MESSAGE",
            }
        ],
        "stop_reason": "stop",
    }
    tracing = FakeTracingService([], [_span("slack__SEND_MESSAGE")])

    result, _, _ = await _run(monkeypatch, outputs=outputs, tracing=tracing)

    assert len(tracing.calls) == 2
    assert result.verdict == "pass"
    assert result.tools[0].returned is True


async def test_registered_test_run_dispatches_through_tools_call(monkeypatch):
    async def _allow(**_kwargs):
        return True

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.check_action_access", _allow)
    HttpxController(
        monkeypatch,
        response=_response(
            {
                "messages": [
                    {
                        "role": "tool",
                        "content": "",
                        "tool_call_id": "call_1",
                        "tool_name": "slack__SEND_MESSAGE",
                    },
                    {"role": "tool", "content": "ok", "tool_call_id": "call_1"},
                ],
                "stop_reason": "stop",
            }
        ),
    )
    router = ToolsRouter(
        tools_service=SimpleNamespace(),
        workflows_service=FakeWorkflowsService(),
        tracing_service=FakeTracingService(),
    )
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=str(uuid4()), user_id=str(uuid4())),
        headers={},
    )
    body = ToolCall(
        data=ToolCallData(
            id="outer_call",
            function=ToolCallFunction(name="tools.agenta.test_run", arguments=_args()),
        )
    )

    response = await router.call_tool(request, body=body)

    content = json.loads(response.call.data.content)
    assert response.call.data.tool_call_id == "outer_call"
    assert content["verdict"] == "pass"
