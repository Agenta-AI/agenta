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
    build_wire_messages,
)


def _make_interaction(
    *,
    with_refs=True,
    kind=SessionInteractionKind.user_input,
    request=None,
    parameters=None,
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
        data=SessionInteractionData(
            references=refs,
            selector=None,
            request=request,
            parameters=parameters,
        ),
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
    # The envelope: exactly what storedApprovalDecisionOf (responder.ts) parses, plus the
    # toolName the cold replay needs to name the call in its resume nudge.
    assert blocks[-1] == {
        "type": "tool_result",
        "toolCallId": "tc-1",
        "toolName": "bash",
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
    assert blocks[1]["toolName"] == "bash"


async def test_replayed_tool_results_carry_the_call_s_tool_name():
    """A tool_result record stores only the call id. The runner's cold replay renders results as
    "[<toolName> returned: ...]" and matches approval nudges by name, so the name must be carried
    forward from the tool_call — otherwise every replayed result is an anonymous "tool" and the
    resume nudge tells the model to call something that does not exist.
    """
    project_id = uuid4()
    records = _approval_records(project_id) + [
        _record(
            project_id,
            rtype="tool_result",
            attributes={"type": "tool_result", "id": "tc-1", "output": "ok"},
            index=3,
        ),
    ]

    messages = build_wire_messages(records)

    blocks = messages[1]["content"]
    result = next(block for block in blocks if block["type"] == "tool_result")
    assert result["toolName"] == "bash"
    assert result["output"] == "ok"


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


# ---------------------------------------------------------------------------
# The effective turn config on the row is replayed inline (effective-turn-config plan, T5-T7)
# ---------------------------------------------------------------------------

_EFFECTIVE_PARAMETERS = {
    "agent": {
        "instructions": "Draft config, committed nowhere.",
        "llm": {"model": "anthropic/claude-sonnet-4-5"},
        "tools": [{"name": "Bash"}],
        "runner": {"permissions": {"default": "allow_reads"}},
    }
}


def test_interaction_data_declares_parameters():
    """The DTO must DECLARE the field or it is dropped twice over.

    ``SessionInteractionData`` is a closed pydantic model with the default
    ``extra="ignore"``, and the postgres mapping round-trips through it on write
    (``model_dump``) and on read (``model_validate``) even though ``data`` is a schemaless
    ``json`` column. An undeclared key written by the runner would vanish on ingest and again
    on read-back, with no error anywhere.
    """
    from oss.src.core.sessions.interactions.dtos import SessionInteractionData

    raw = {
        "request": {"tool": "Bash", "args": {"command": "echo hi"}},
        "parameters": _EFFECTIVE_PARAMETERS,
    }
    parsed = SessionInteractionData.model_validate(raw)
    assert parsed.parameters == _EFFECTIVE_PARAMETERS

    dumped = parsed.model_dump(mode="json", exclude_none=True)
    assert dumped["parameters"] == _EFFECTIVE_PARAMETERS
    assert SessionInteractionData.model_validate(dumped).parameters == (
        _EFFECTIVE_PARAMETERS
    )


def test_postgres_mapping_round_trips_the_stamped_config():
    """create -> row -> read-back through the REAL postgres mappings (both are pure).

    This is the ingest path the runner actually hits: the create mapping dumps the DTO into
    the ``json`` column and the read mapping validates it back. Either direction silently
    drops an undeclared key, which is what makes this the guard for the ``extra="ignore"``
    trap rather than the DTO test above.
    """
    from oss.src.core.sessions.interactions.dtos import (
        SessionInteractionCreate,
        SessionInteractionData,
        SessionInteractionKind as Kind,
    )
    from oss.src.dbs.postgres.sessions.interactions.mappings import (
        map_interaction_dbe_to_dto,
        map_interaction_dto_to_dbe_create,
    )

    project_id = uuid4()
    dbe = map_interaction_dto_to_dbe_create(
        project_id=project_id,
        user_id=uuid4(),
        interaction=SessionInteractionCreate(
            project_id=project_id,
            session_id="sess-test-1",
            turn_id="turn-1",
            token="tok-abc",
            kind=Kind.user_approval,
            data=SessionInteractionData(
                request={"tool": "Bash", "args": {"command": "echo hi"}},
                parameters=_EFFECTIVE_PARAMETERS,
            ),
        ),
    )
    assert dbe.data["parameters"] == _EFFECTIVE_PARAMETERS

    dbe.id = uuid4()
    dbe.created_at = dbe.updated_at = None
    dbe.deleted_at = dbe.updated_by_id = dbe.deleted_by_id = None
    read_back = map_interaction_dbe_to_dto(dbe)
    assert read_back.data.parameters == _EFFECTIVE_PARAMETERS
    # `request` reads back as the typed SessionInteractionRequest, not a bare dict.
    assert read_back.data.request.tool == "Bash"
    assert read_back.data.request.args == {"command": "echo hi"}


def test_interaction_data_omits_parameters_when_unstamped():
    # A legacy row (and any turn whose config was too large or unsafe to stamp) must serialize
    # to exactly the shape it had before this field existed.
    from oss.src.core.sessions.interactions.dtos import SessionInteractionData

    dumped = SessionInteractionData.model_validate(
        {"request": {"tool": "Bash", "args": None}}
    ).model_dump(mode="json", exclude_none=True)
    assert "parameters" not in dumped


async def test_respond_sends_the_stamped_config_inline_with_references():
    """Parameters present -> inline on the invoke, references still sent.

    Inline parameters are exactly what suppresses hydration in the SDK resolver
    (``_caller_supplied_configuration``), so the resumed run continues under the gated turn's
    own config instead of the referenced variant's HEAD revision.
    """
    project_id = uuid4()
    interaction = _make_interaction(
        kind=SessionInteractionKind.user_approval,
        parameters=_EFFECTIVE_PARAMETERS,
    )
    dispatch_fn = AsyncMock()
    dispatcher = _dispatcher_with(
        interaction, _approval_records(project_id), dispatch_fn
    )

    await dispatcher.respond(
        project_id=project_id,
        user_id=uuid4(),
        interaction_id=interaction.id,
        answer={"approved": True},
    )

    request = dispatch_fn.await_args.kwargs["request"]
    assert request.data.parameters == _EFFECTIVE_PARAMETERS
    # References still ride along: attribution, plus the hydration fallback if the inline
    # config is ever dropped upstream.
    assert request.references["workflow"].slug == "wf-1"
    assert request.session_id == "sess-test-1"
    # The composed resume conversation is untouched by the config replay.
    assert request.data.inputs["messages"][0] == {
        "role": "user",
        "content": "run the migration",
    }


async def test_respond_on_a_pre_change_row_stays_references_only():
    # Backward compatibility: a row written before the runner stamped configs must produce the
    # byte-identical body this dispatcher has always sent, so it hydrates as it does today.
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
        answer={"approved": True},
    )

    request = dispatch_fn.await_args.kwargs["request"]
    assert request.data.parameters is None
    assert request.data.model_dump(exclude_none=True).keys() == {"inputs"}
    assert request.references["workflow"].slug == "wf-1"


async def test_respond_passes_the_stamped_config_on_the_blocking_path_too():
    # The non-detached path (no dispatch_fn) builds the same request object.
    interaction = _make_interaction(
        kind=SessionInteractionKind.user_approval,
        parameters=_EFFECTIVE_PARAMETERS,
    )

    interactions_service = MagicMock()
    interactions_service.fetch_interaction = AsyncMock(return_value=interaction)
    workflows_service = MagicMock()
    workflows_service.invoke_workflow = AsyncMock(return_value=SimpleNamespace())

    dispatcher = InteractionsDispatcher(
        workflows_service=workflows_service,
        interactions_service=interactions_service,
    )

    await dispatcher.respond(
        project_id=uuid4(),
        user_id=uuid4(),
        interaction_id=interaction.id,
        answer={"approved": True},
    )

    request = workflows_service.invoke_workflow.await_args.kwargs["request"]
    assert request.data.parameters == _EFFECTIVE_PARAMETERS


async def test_the_stored_call_id_anchors_the_envelope_when_records_are_missing():
    """Warm-resume matching is strict on `toolCallId`. With no records to replay, falling
    straight through to the token misses the parked gate and degrades an answerable turn to a
    cold replay -- even though the row has carried the harness call id since gate creation."""
    project_id = uuid4()
    interaction = _make_interaction(
        kind=SessionInteractionKind.user_approval,
        request={
            "tool": "bash",
            "args": {"command": "rm -rf ./build"},
            "tool_call_id": "toolu_stored_1",
        },
    )
    dispatch_fn = AsyncMock()
    dispatcher = _dispatcher_with(interaction, [], dispatch_fn)

    await dispatcher.respond(
        project_id=project_id,
        user_id=uuid4(),
        interaction_id=interaction.id,
        answer={"approved": True},
    )

    blocks = dispatch_fn.await_args.kwargs["request"].data.inputs["messages"][0][
        "content"
    ]
    assert blocks[0]["toolCallId"] == "toolu_stored_1", (
        "the token is the last resort, not the second one"
    )
    assert blocks[-1]["toolCallId"] == "toolu_stored_1"


async def test_an_explicit_client_id_still_outranks_the_stored_one():
    project_id = uuid4()
    interaction = _make_interaction(
        kind=SessionInteractionKind.user_approval,
        request={"tool": "bash", "args": {}, "tool_call_id": "toolu_stored_1"},
    )
    dispatch_fn = AsyncMock()
    dispatcher = _dispatcher_with(interaction, [], dispatch_fn)

    await dispatcher.respond(
        project_id=project_id,
        user_id=uuid4(),
        interaction_id=interaction.id,
        answer={"approved": True, "tool_call_id": "toolu_from_client"},
    )

    blocks = dispatch_fn.await_args.kwargs["request"].data.inputs["messages"][0][
        "content"
    ]
    assert blocks[0]["toolCallId"] == "toolu_from_client"


def test_user_records_replay_their_attachments():
    """A detached approval reconstructs the model's context. Dropping the files off a user turn
    hands the agent a different conversation than the one the human approved against, and an
    attachment-only turn vanishes entirely."""
    project_id = uuid4()
    records = [
        _record(
            project_id,
            source="user",
            rtype="message",
            attributes={
                "type": "message",
                "text": "review this",
                "attachments": [
                    {
                        "attachmentId": "att-1",
                        "filename": "spec.pdf",
                        "mediaType": "application/pdf",
                        "size": 12,
                    }
                ],
            },
        ),
    ]

    messages = build_wire_messages(records)

    assert messages == [
        {
            "role": "user",
            "content": [
                {
                    "type": "attachment",
                    "attachmentId": "att-1",
                    "filename": "spec.pdf",
                    "mimeType": "application/pdf",
                    "size": 12,
                },
                {"type": "text", "text": "review this"},
            ],
        }
    ]


def test_an_attachment_only_user_record_still_replays():
    project_id = uuid4()
    records = [
        _record(
            project_id,
            source="user",
            rtype="message",
            attributes={
                "type": "message",
                "attachments": [{"attachmentId": "att-1"}],
            },
        ),
    ]

    assert build_wire_messages(records) == [
        {
            "role": "user",
            "content": [
                {"type": "attachment", "attachmentId": "att-1"},
                {"type": "text", "text": ""},
            ],
        }
    ]


def test_a_user_record_with_neither_text_nor_attachments_is_skipped():
    project_id = uuid4()
    records = [
        _record(
            project_id, source="user", rtype="message", attributes={"type": "message"}
        ),
    ]

    assert build_wire_messages(records) == []
