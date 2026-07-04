"""The ``/tools/call`` server-side execute branch for workflow-reference (type:"reference") tools.

A type:"reference" agent tool resolves (SDK-side) to a ``callback`` spec whose call_ref is
``workflow.variant.{slug}[.{version}]`` or ``workflow.environment.{environment}.{slug}``. When the
model calls it the runner POSTs the OpenAI tool-call envelope back to ``/tools/call``; the router
routes the ``workflow.*`` prefix to ``_call_workflow_tool``, which invokes the selected workflow
revision with the model's arguments and returns its outputs as the tool result. These tests
exercise that handler directly with a fake WorkflowsService (no DB, no live workflow service).
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.core.tools.dtos import ToolCall, ToolCallData, ToolCallFunction


class FakeWorkflowsService:
    """Records the invoke call and returns a canned batch response."""

    def __init__(
        self, *, outputs=None, status_code=200, status_message=None, raises=None
    ):
        self._outputs = outputs
        self._status_code = status_code
        self._status_message = status_message
        self._raises = raises
        self.calls: list[dict] = []

    async def invoke_workflow(self, *, project_id, user_id, request):
        self.calls.append(
            {"project_id": project_id, "user_id": user_id, "request": request}
        )
        if self._raises is not None:
            raise self._raises
        return SimpleNamespace(
            data=SimpleNamespace(outputs=self._outputs),
            status=SimpleNamespace(
                code=self._status_code, message=self._status_message
            ),
        )


def _router(workflows_service):
    # The Composio ToolsService is unused on the workflow branch; a stub is fine.
    return ToolsRouter(
        tools_service=SimpleNamespace(),
        workflows_service=workflows_service,
    )


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


async def test_unknown_tools_agenta_call_ref_posted_to_tools_call_fails_loud(
    monkeypatch,
):
    async def _allow(**_kwargs):
        return True

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.check_action_access", _allow)

    with pytest.raises(HTTPException) as caught:
        await _router(FakeWorkflowsService(outputs={})).call_tool(
            _request(),
            body=_call("tools.agenta.unknown", {}),
        )

    assert caught.value.status_code == 404
    assert "Unknown reserved Agenta tool handler" in caught.value.detail


async def test_invokes_workflow_by_variant_slug_and_returns_outputs():
    workflows = FakeWorkflowsService(outputs={"summary": "ok"})
    router = _router(workflows)
    request = _request()

    response = await router._call_workflow_tool(
        request=request,
        body=_call("workflow.variant.summarize", {"text": "hello"}),
    )

    # One invoke, scoped to the caller's project + user.
    assert len(workflows.calls) == 1
    call = workflows.calls[0]
    assert str(call["project_id"]) == request.state.project_id
    assert str(call["user_id"]) == request.state.user_id
    # The variant axis targets the workflow by slug; arguments ride as inputs.
    refs = call["request"].references
    assert refs["workflow"].slug == "summarize"
    assert refs["workflow"].version is None
    assert "environment" not in refs
    assert call["request"].data.inputs == {"text": "hello"}
    # The outputs come back as the tool result content (a JSON string).
    result = response.call
    assert result.status.code == "STATUS_CODE_OK"
    assert json.loads(result.data.content) == {"summary": "ok"}
    assert result.data.tool_call_id == "call_1"


async def test_versioned_variant_call_ref_pins_revision():
    workflows = FakeWorkflowsService(outputs=1)
    await _router(workflows)._call_workflow_tool(
        request=_request(),
        body=_call("workflow.variant.summarize.3", {}),
    )
    refs = workflows.calls[0]["request"].references
    assert refs["workflow"].slug == "summarize"
    assert refs["workflow"].version == "3"


async def test_environment_axis_targets_environment_and_workflow():
    workflows = FakeWorkflowsService(outputs={"ok": True})
    await _router(workflows)._call_workflow_tool(
        request=_request(),
        body=_call("workflow.environment.production.summarize", {}),
    )
    refs = workflows.calls[0]["request"].references
    # The environment selects the revision; the workflow ref supplies the selector key slug.
    assert refs["environment"].slug == "production"
    assert refs["workflow"].slug == "summarize"
    assert refs["workflow"].version is None


async def test_double_underscore_call_ref_is_normalized():
    # LLM function names forbid dots; the runner may send the __ form.
    workflows = FakeWorkflowsService(outputs={})
    await _router(workflows)._call_workflow_tool(
        request=_request(),
        body=_call("workflow__variant__summarize", {}),
    )
    assert workflows.calls[0]["request"].references["workflow"].slug == "summarize"


async def test_json_string_arguments_are_parsed():
    workflows = FakeWorkflowsService(outputs={})
    await _router(workflows)._call_workflow_tool(
        request=_request(),
        body=_call("workflow.variant.wf", '{"a": 1}'),
    )
    assert workflows.calls[0]["request"].data.inputs == {"a": 1}


async def test_workflow_error_status_maps_to_error_result():
    workflows = FakeWorkflowsService(
        outputs=None, status_code=400, status_message="no runnable service URL"
    )
    response = await _router(workflows)._call_workflow_tool(
        request=_request(),
        body=_call("workflow.variant.missing", {}),
    )
    assert response.call.status.code == "STATUS_CODE_ERROR"
    assert response.call.status.message == "no runnable service URL"


async def test_invoke_exception_surfaces_as_502():
    workflows = FakeWorkflowsService(raises=RuntimeError("boom"))
    with pytest.raises(HTTPException) as caught:
        await _router(workflows)._call_workflow_tool(
            request=_request(),
            body=_call("workflow.variant.wf", {}),
        )
    assert caught.value.status_code == 502


async def test_missing_workflows_service_returns_501():
    with pytest.raises(HTTPException) as caught:
        await _router(None)._call_workflow_tool(
            request=_request(),
            body=_call("workflow.variant.wf", {}),
        )
    assert caught.value.status_code == 501


@pytest.mark.parametrize(
    "name",
    [
        "workflow.",  # empty axis
        "workflow.variant",  # variant axis, no slug
        "workflow.variant.wf.1.2",  # variant axis, too many segments
        "workflow.variant.bad slug",  # invalid characters
        "workflow.environment.production",  # environment axis missing workflow slug
        "workflow.environment.prod.wf.extra",  # environment axis, too many segments
        "workflow.unknown.wf",  # unknown axis
    ],
)
async def test_malformed_call_ref_rejected(name):
    workflows = FakeWorkflowsService(outputs={})
    with pytest.raises(HTTPException) as caught:
        await _router(workflows)._call_workflow_tool(
            request=_request(),
            body=_call(name, {}),
        )
    assert caught.value.status_code == 400
    assert workflows.calls == []
