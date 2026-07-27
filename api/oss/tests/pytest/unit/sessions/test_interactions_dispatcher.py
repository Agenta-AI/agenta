"""Unit tests for InteractionsDispatcher — blocking and detached dispatch paths,
plus the M2 approval-answer composition (records replay -> runner-visible envelope)."""

from types import SimpleNamespace
from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

from oss.src.apis.fastapi.sessions.models import SessionInteractionCreateRequest
from oss.src.core.sessions.interactions.dtos import SessionInteractionKind
from oss.src.core.sessions.records.dtos import SessionRecord

from oss.src.tasks.asyncio.sessions.interactions_dispatcher import (
    InteractionsDispatcher,
)


def _make_interaction(
    *,
    with_refs=True,
    kind=SessionInteractionKind.user_input,
    request=None,
):
    from oss.src.core.sessions.interactions.dtos import (
        SessionInteraction,
        SessionInteractionData,
        SessionInteractionStatus,
    )
    from oss.src.core.shared.dtos import Reference

    refs = {"workflow": Reference(slug="wf-1")} if with_refs else None
    return SessionInteraction(
        id=uuid4(),
        project_id=uuid4(),
        session_id="sess-test-1",
        token="tok-abc",
        kind=kind,
        status=SessionInteractionStatus.pending,
        data=SessionInteractionData(references=refs, selector=None, request=request),
    )


def _record(project_id, *, source="agent", rtype, attributes, index=0):
    return SessionRecord(
        record_id=uuid4(),
        session_id="sess-test-1",
        project_id=project_id,
        record_index=index,
        record_type=rtype,
        record_source=source,
        attributes=attributes,
    )


def _approval_records(project_id, *, token="tok-abc", tool_call_id="tc-1"):
    """A one-turn approval transcript: user prompt, gated tool call, pending gate."""
    return [
        _record(
            project_id,
            source="user",
            rtype="message",
            attributes={"type": "message", "text": "run the migration"},
            index=0,
        ),
        _record(
            project_id,
            rtype="tool_call",
            attributes={
                "type": "tool_call",
                "id": tool_call_id,
                "name": "bash",
                "input": {"command": "alembic upgrade head"},
            },
            index=1,
        ),
        _record(
            project_id,
            rtype="interaction_request",
            attributes={
                "type": "interaction_request",
                "id": token,
                "kind": "user_approval",
                "payload": {
                    "toolCallId": tool_call_id,
                    "toolCall": {
                        "toolCallId": tool_call_id,
                        "resolvedName": "bash",
                        "rawInput": {"command": "alembic upgrade head"},
                    },
                },
            },
            index=2,
        ),
    ]


def _dispatcher_with(interaction, records, dispatch_fn):
    interactions_service = MagicMock()
    interactions_service.fetch_interaction = AsyncMock(return_value=interaction)
    records_service = MagicMock()
    records_service.get_records = AsyncMock(return_value=records)
    return InteractionsDispatcher(
        workflows_service=MagicMock(),
        interactions_service=interactions_service,
        records_service=records_service,
        dispatch_fn=dispatch_fn,
    )


def test_create_request_accepts_omitted_workflow_references():
    request = SessionInteractionCreateRequest(
        session_id="sess-no-refs",
        turn_id="turn-no-refs",
        token="token-no-refs",
        kind=SessionInteractionKind.user_approval,
        data={"request": {"tool": "bash", "args": {"command": "pwd"}}},
    )

    assert request.data is not None
    assert request.data.references is None


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


async def test_respond_without_references_builds_a_safe_reference_less_request():
    interaction = _make_interaction(with_refs=False)
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
        answer={"approved": True},
    )

    workflows_service.invoke_workflow.assert_awaited_once()
    invoke_request = workflows_service.invoke_workflow.await_args.kwargs["request"]
    assert invoke_request.references is None
    assert invoke_request.session_id == interaction.session_id


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


# ---------------------------------------------------------------------------
# M2: approval answers compose the runner-visible resume conversation
# ---------------------------------------------------------------------------


async def test_approval_respond_composes_resume_messages_from_records():
    """The dispatched inputs must be a replayable conversation ending in the
    {approved, interactionToken} tool_result the runner's decision map reads,
    bound to the gated toolCallId — and must never carry data.parameters (the
    resolver hydrates config from references server-side only when absent)."""
    project_id = uuid4()
    interaction = _make_interaction(kind=SessionInteractionKind.user_approval)
    records = _approval_records(project_id)
    dispatch_fn = AsyncMock()
    dispatcher = _dispatcher_with(interaction, records, dispatch_fn)

    await dispatcher.respond(
        project_id=project_id,
        user_id=uuid4(),
        interaction_id=interaction.id,
        answer={"approved": True},
    )

    request = dispatch_fn.await_args.kwargs["request"]
    assert request.session_id == "sess-test-1"
    assert request.data.parameters is None
    messages = request.data.inputs["messages"]

    assert messages[0] == {"role": "user", "content": "run the migration"}
    assert messages[1]["role"] == "assistant"
    blocks = messages[1]["content"]
    assert blocks[0] == {
        "type": "tool_call",
        "toolCallId": "tc-1",
        "toolName": "bash",
        "input": {"command": "alembic upgrade head"},
    }
    # The envelope: exactly what storedApprovalDecisionOf (responder.ts) parses.
    assert blocks[-1] == {
        "type": "tool_result",
        "toolCallId": "tc-1",
        "output": {"approved": True, "interactionToken": "tok-abc"},
    }
    # No extra user message was introduced (prompt count parity for warm resume).
    assert sum(1 for m in messages if m["role"] == "user") == 1


async def test_denial_with_message_appends_a_trailing_user_note():
    project_id = uuid4()
    interaction = _make_interaction(kind=SessionInteractionKind.user_approval)
    dispatch_fn = AsyncMock()
    dispatcher = _dispatcher_with(
        interaction, _approval_records(project_id), dispatch_fn
    )

    await dispatcher.respond(
        project_id=project_id,
        user_id=uuid4(),
        interaction_id=interaction.id,
        answer={"approved": False, "message": "use --dry-run instead"},
    )

    messages = dispatch_fn.await_args.kwargs["request"].data.inputs["messages"]
    envelope = messages[-2]["content"][-1]
    assert envelope["output"] == {"approved": False, "interactionToken": "tok-abc"}
    assert messages[-1] == {"role": "user", "content": "use --dry-run instead"}


async def test_approval_respond_without_records_synthesizes_the_anchor():
    """No durable records (minimal composition, ingest failure): the dispatcher must still
    emit a tool_call block sharing the envelope's id so the runner's call-shape index can
    bind the decision to name+args on cold replay."""
    project_id = uuid4()
    interaction = _make_interaction(
        kind=SessionInteractionKind.user_approval,
        request={"tool": "bash", "args": {"command": "rm -rf ./build"}},
    )
    dispatch_fn = AsyncMock()
    dispatcher = _dispatcher_with(interaction, [], dispatch_fn)

    await dispatcher.respond(
        project_id=project_id,
        user_id=uuid4(),
        interaction_id=interaction.id,
        answer={"approved": True},
    )

    messages = dispatch_fn.await_args.kwargs["request"].data.inputs["messages"]
    assert len(messages) == 1
    blocks = messages[0]["content"]
    assert blocks[0] == {
        "type": "tool_call",
        "toolCallId": "tok-abc",
        "toolName": "bash",
        "input": {"command": "rm -rf ./build"},
    }
    assert blocks[1]["output"] == {"approved": True, "interactionToken": "tok-abc"}


async def test_explicit_tool_call_id_wins_over_the_records_lookup():
    project_id = uuid4()
    interaction = _make_interaction(kind=SessionInteractionKind.user_approval)
    dispatch_fn = AsyncMock()
    dispatcher = _dispatcher_with(
        interaction, _approval_records(project_id), dispatch_fn
    )

    await dispatcher.respond(
        project_id=project_id,
        user_id=uuid4(),
        interaction_id=interaction.id,
        answer={"approved": True, "tool_call_id": "tc-9"},
    )

    messages = dispatch_fn.await_args.kwargs["request"].data.inputs["messages"]
    envelope = messages[-1]["content"][-1]
    assert envelope["toolCallId"] == "tc-9"
    # tc-9 has no tool_call record, so the anchor was synthesized for it.
    assert any(
        block.get("type") == "tool_call" and block.get("toolCallId") == "tc-9"
        for message in messages
        if isinstance(message["content"], list)
        for block in message["content"]
    )


async def test_non_approval_answers_still_pass_through_unchanged():
    project_id = uuid4()
    interaction = _make_interaction(kind=SessionInteractionKind.user_input)
    dispatch_fn = AsyncMock()
    dispatcher = _dispatcher_with(
        interaction, _approval_records(project_id), dispatch_fn
    )

    await dispatcher.respond(
        project_id=project_id,
        user_id=uuid4(),
        interaction_id=interaction.id,
        answer={"reply": "yes"},
    )

    assert dispatch_fn.await_args.kwargs["request"].data.inputs == {"reply": "yes"}


async def test_approval_answer_without_a_boolean_verdict_passes_through():
    project_id = uuid4()
    interaction = _make_interaction(kind=SessionInteractionKind.user_approval)
    dispatch_fn = AsyncMock()
    dispatcher = _dispatcher_with(
        interaction, _approval_records(project_id), dispatch_fn
    )

    await dispatcher.respond(
        project_id=project_id,
        user_id=uuid4(),
        interaction_id=interaction.id,
        answer={"approved": "yep"},
    )

    assert dispatch_fn.await_args.kwargs["request"].data.inputs == {"approved": "yep"}
