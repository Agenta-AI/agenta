"""Unit tests for InteractionsDispatcher — blocking and detached dispatch paths."""

from types import SimpleNamespace
from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

from oss.src.tasks.asyncio.sessions.interactions_dispatcher import (
    InteractionsDispatcher,
)


def _make_interaction(*, with_refs=True):
    from oss.src.core.sessions.interactions.dtos import (
        SessionInteraction,
        SessionInteractionData,
        SessionInteractionKind,
        SessionInteractionStatus,
    )
    from oss.src.core.shared.dtos import Reference

    refs = {"workflow": Reference(slug="wf-1")} if with_refs else None
    return SessionInteraction(
        id=uuid4(),
        project_id=uuid4(),
        session_id="sess-test-1",
        token="tok-abc",
        kind=SessionInteractionKind.user_input,
        status=SessionInteractionStatus.pending,
        data=SessionInteractionData(references=refs, selector=None),
    )


async def test_respond_fallback_calls_invoke_when_no_dispatch_fn():
    interaction = _make_interaction()
    project_id = uuid4()
    user_id = uuid4()

    interactions_service = MagicMock()
    interactions_service.fetch_interaction = AsyncMock(return_value=interaction)

    workflows_service = MagicMock()
    workflows_service.invoke_workflow = AsyncMock(return_value=SimpleNamespace())

    worker = InteractionsDispatcher(
        workflows_service=workflows_service,
        interactions_service=interactions_service,
    )

    await worker.respond(
        project_id=project_id,
        user_id=user_id,
        interaction_id=interaction.id,
        answer={"reply": "yes"},
    )

    workflows_service.invoke_workflow.assert_awaited_once()
    invoke_kwargs = workflows_service.invoke_workflow.await_args.kwargs
    assert invoke_kwargs["project_id"] == project_id
    assert invoke_kwargs["user_id"] == user_id


async def test_respond_detached_calls_dispatch_fn_not_invoke():
    interaction = _make_interaction()
    project_id = uuid4()
    user_id = uuid4()

    interactions_service = MagicMock()
    interactions_service.fetch_interaction = AsyncMock(return_value=interaction)

    workflows_service = MagicMock()
    workflows_service.invoke_workflow = AsyncMock()

    dispatch_fn = AsyncMock(return_value="run-xyz")

    worker = InteractionsDispatcher(
        workflows_service=workflows_service,
        interactions_service=interactions_service,
        dispatch_fn=dispatch_fn,
    )

    await worker.respond(
        project_id=project_id,
        user_id=user_id,
        interaction_id=interaction.id,
        answer={"reply": "yes"},
    )

    dispatch_fn.assert_awaited_once()
    dispatch_kwargs = dispatch_fn.await_args.kwargs
    assert dispatch_kwargs["project_id"] == project_id
    assert dispatch_kwargs["user_id"] == user_id
    assert dispatch_kwargs["request"] is not None

    # blocking path must NOT be called
    workflows_service.invoke_workflow.assert_not_awaited()
