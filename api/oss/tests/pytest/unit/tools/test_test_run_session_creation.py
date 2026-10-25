"""Test attribution is durable before dispatch, without changing heartbeat admission."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from agenta.sdk.models.shared import resolve_session_id
from agenta.sdk.models.workflows import WorkflowServiceStatus
from oss.src.core.tools import platform_handlers as handlers
from oss.src.core.tools.exceptions import PlatformToolHandlerUnavailable
from oss.src.core.workflows.dtos import WorkflowServiceBatchResponse

from unit.tools.test_platform_handlers import FakeWorkflowsService, _args


def setup_call():
    dao = SimpleNamespace(create=AsyncMock(), delete_by_session_id=AsyncMock())
    workflows = FakeWorkflowsService()
    kwargs = {
        "arguments": _args(),
        "headers": {},
        "project_id": uuid4(),
        "user_id": uuid4(),
        "workflows_service": workflows,
        "tracing_service": None,
        "session_streams_dao": dao,
    }
    return dao, workflows, kwargs


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [200, 400, 502, 504])
async def test_persist_before_launch_and_retain_on_ambiguous_failure(
    monkeypatch, status
):
    dao, workflows, kwargs = setup_call()
    seen = []

    async def invoke(**call):
        dao.create.assert_awaited_once()
        saved = dao.create.await_args.kwargs
        request = call["request"]
        assert saved["project_id"] == kwargs["project_id"]
        assert saved["user_id"] == kwargs["user_id"]
        assert saved["stream"].origin == "agent"
        assert saved["stream"].turn_id is None
        assert saved["stream"].flags is None
        assert saved["stream"].session_id == request.session_id
        assert resolve_session_id(request.session_id) == request.session_id
        assert request.meta["run_kind"] == "test"  # recursion protection remains
        seen.append(request.session_id)
        return WorkflowServiceBatchResponse(status=WorkflowServiceStatus(code=status))

    monkeypatch.setattr(handlers, "_invoke_child_workflow", invoke)
    await handlers.handle_test_run(**kwargs)
    assert len(seen) == 1
    dao.delete_by_session_id.assert_not_awaited()
    assert workflows.prepare_calls[0]["request"].session_id == seen[0]


@pytest.mark.asyncio
async def test_missing_service_does_not_create_session(monkeypatch):
    dao, workflows, kwargs = setup_call()
    workflows.service_url = None
    invoke = AsyncMock()
    monkeypatch.setattr(handlers, "_invoke_child_workflow", invoke)
    await handlers.handle_test_run(**kwargs)
    dao.create.assert_not_awaited()
    invoke.assert_not_awaited()


@pytest.mark.asyncio
async def test_failed_preparation_creates_no_placeholder(monkeypatch):
    dao, workflows, kwargs = setup_call()
    workflows._prepare_invoke = AsyncMock(side_effect=RuntimeError("preparation failed"))
    invoke = AsyncMock()
    monkeypatch.setattr(handlers, "_invoke_child_workflow", invoke)
    with pytest.raises(RuntimeError, match="preparation failed"):
        await handlers.handle_test_run(**kwargs)
    dao.create.assert_not_awaited()
    invoke.assert_not_awaited()


@pytest.mark.asyncio
async def test_failed_persistence_never_launches_child(monkeypatch):
    dao, _, kwargs = setup_call()
    dao.create.side_effect = RuntimeError("database unavailable")
    invoke = AsyncMock()
    monkeypatch.setattr(handlers, "_invoke_child_workflow", invoke)
    with pytest.raises(RuntimeError, match="database unavailable"):
        await handlers.handle_test_run(**kwargs)
    invoke.assert_not_awaited()


@pytest.mark.asyncio
async def test_missing_dependency_fails_closed(monkeypatch):
    dao, _, kwargs = setup_call()
    kwargs["session_streams_dao"] = None
    invoke = AsyncMock()
    monkeypatch.setattr(handlers, "_invoke_child_workflow", invoke)
    with pytest.raises(PlatformToolHandlerUnavailable, match="session persistence"):
        await handlers.handle_test_run(**kwargs)
    dao.create.assert_not_awaited()
    invoke.assert_not_awaited()


@pytest.mark.asyncio
async def test_separate_tool_calls_have_separate_child_sessions(monkeypatch):
    dao, _, kwargs = setup_call()
    invoke = AsyncMock(
        return_value=WorkflowServiceBatchResponse(
            status=WorkflowServiceStatus(code=504)
        )
    )
    monkeypatch.setattr(handlers, "_invoke_child_workflow", invoke)
    await handlers.handle_test_run(**kwargs)
    await handlers.handle_test_run(**kwargs)
    ids = [call.kwargs["stream"].session_id for call in dao.create.await_args_list]
    assert len(set(ids)) == 2
    assert [call.kwargs["request"].session_id for call in invoke.await_args_list] == ids
