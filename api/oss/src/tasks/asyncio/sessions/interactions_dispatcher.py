"""Respond-via-invoke: turn a stored human answer into a detached workflow run.

For a ``user_approval`` interaction the dispatcher composes the runner-visible
resume conversation SERVER-SIDE (mobile approvals plan, M2.1): it replays the
session's durable records into wire messages and appends the approval envelope
``{approved, interactionToken}`` as a ``tool_result`` block bound to the gated
``toolCallId`` — the exact shape the runner's decision map reads
(``services/runner/src/responder.ts`` ``storedApprovalDecisionOf`` /
``session-identity.ts`` ``approvalDecisionForToolCall``). The client payload
stays minimal: ``{approved: bool, tool_call_id?, message?}``.

Every other interaction kind keeps the original passthrough contract
(``data.inputs = answer``).
"""

from typing import Any, Callable, Dict, List, Optional
from uuid import UUID

from oss.src.core.sessions.interactions.dtos import (
    SessionInteraction,
    SessionInteractionData,
    SessionInteractionKind,
)
from oss.src.core.sessions.records.dtos import SessionRecord
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.workflows.dtos import (
    WorkflowServiceRequest,
    WorkflowServiceRequestData,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


def build_wire_messages(records: List[SessionRecord]) -> List[Dict[str, Any]]:
    """Replay durable session records into runner wire messages.

    Mirrors the frontend's ``transcriptToMessages`` grouping: a ``user`` record opens a
    user message; a contiguous run of agent records folds into one assistant message whose
    content blocks carry text and resolved tool turns. Non-conversation records (thoughts,
    usage, errors, interaction bookkeeping) are skipped — they are renderable history, not
    replayable conversation.
    """
    messages: List[Dict[str, Any]] = []
    assistant_blocks: Optional[List[Dict[str, Any]]] = None

    def close_assistant() -> None:
        nonlocal assistant_blocks
        assistant_blocks = None

    def assistant() -> List[Dict[str, Any]]:
        nonlocal assistant_blocks
        if assistant_blocks is None:
            assistant_blocks = []
            messages.append({"role": "assistant", "content": assistant_blocks})
        return assistant_blocks

    for record in records:
        attributes = record.attributes or {}
        record_type = record.record_type or attributes.get("type")

        if record.record_source == "user":
            text = attributes.get("text")
            if isinstance(text, str) and text:
                close_assistant()
                messages.append({"role": "user", "content": text})
            continue

        if record_type == "message":
            text = attributes.get("text")
            if isinstance(text, str) and text:
                assistant().append({"type": "text", "text": text})
        elif record_type == "tool_call":
            block: Dict[str, Any] = {"type": "tool_call"}
            if attributes.get("id"):
                block["toolCallId"] = attributes["id"]
            if attributes.get("name"):
                block["toolName"] = attributes["name"]
            if attributes.get("input") is not None:
                block["input"] = attributes["input"]
            assistant().append(block)
        elif record_type == "tool_result":
            block = {"type": "tool_result"}
            if attributes.get("id"):
                block["toolCallId"] = attributes["id"]
            output = attributes.get("data")
            if output is None:
                output = attributes.get("output")
            if output is not None:
                block["output"] = output
            if attributes.get("isError") is not None:
                block["isError"] = attributes["isError"]
            assistant().append(block)
        # Everything else (thought, usage, error, done, data, file, interaction_request,
        # interaction_response) is not part of the replayable conversation.

    return messages


def resolve_gated_tool_call_id(
    records: List[SessionRecord],
    interaction: SessionInteraction,
    answer: Dict[str, Any],
) -> str:
    """The tool-call id the envelope must bind to.

    Precedence: the client's explicit ``tool_call_id``; else the persisted
    ``interaction_request`` record whose event id is the interaction token (its payload
    carries the gated ``toolCallId``); else the token itself (the runner's event id falls
    back to the tool-call id when the permission id is empty, so this stays a valid anchor
    for the synthesized-history path).
    """
    explicit = answer.get("tool_call_id")
    if isinstance(explicit, str) and explicit:
        return explicit

    for record in records:
        attributes = record.attributes or {}
        record_type = record.record_type or attributes.get("type")
        if record_type != "interaction_request":
            continue
        if attributes.get("id") != interaction.token:
            continue
        payload = attributes.get("payload") or {}
        tool_call_id = payload.get("toolCallId")
        if isinstance(tool_call_id, str) and tool_call_id:
            return tool_call_id

    return interaction.token


def _gated_call_shape(
    records: List[SessionRecord],
    interaction: SessionInteraction,
) -> Dict[str, Any]:
    """Recover the gated call's name+args (the runner's cold-replay anchor)."""
    for record in records:
        attributes = record.attributes or {}
        record_type = record.record_type or attributes.get("type")
        if record_type != "interaction_request":
            continue
        if attributes.get("id") != interaction.token:
            continue
        tool_call = (attributes.get("payload") or {}).get("toolCall") or {}
        name = tool_call.get("resolvedName") or tool_call.get("title")
        args = tool_call.get("rawInput")
        if name or args is not None:
            return {"name": name, "args": args}

    data: Optional[SessionInteractionData] = interaction.data
    request = (data.request if data else None) or {}
    return {"name": request.get("tool"), "args": request.get("args")}


def compose_approval_messages(
    records: List[SessionRecord],
    interaction: SessionInteraction,
    answer: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """The full resume conversation: replayed history + the approval envelope.

    The envelope rides as a ``tool_result`` block on the LAST assistant message (never a
    new user message — the runner's history fingerprint counts user prompts, and the
    envelope's tool-call id dedupes against the already-present ``tool_call`` block, so a
    warm-parked sandbox still fingerprint-matches and resumes live). An optional
    deny-with-redirect ``message`` is appended as a trailing user message, which the
    fingerprint's prior-conversation slice excludes.
    """
    messages = build_wire_messages(records)
    gated_id = resolve_gated_tool_call_id(records, interaction, answer)

    has_gated_call = any(
        block.get("type") == "tool_call" and block.get("toolCallId") == gated_id
        for message in messages
        if isinstance(message.get("content"), list)
        for block in message["content"]
    )
    if not has_gated_call:
        # No durable tool_call record (e.g. records unavailable): synthesize the anchor the
        # runner's call-shape index needs to bind the envelope to name+args.
        shape = _gated_call_shape(records, interaction)
        block = {"type": "tool_call", "toolCallId": gated_id}
        if shape.get("name"):
            block["toolName"] = shape["name"]
        if shape.get("args") is not None:
            block["input"] = shape["args"]
        messages.append({"role": "assistant", "content": [block]})

    envelope = {
        "type": "tool_result",
        "toolCallId": gated_id,
        "output": {
            "approved": bool(answer.get("approved")),
            "interactionToken": interaction.token,
        },
    }
    tail = messages[-1] if messages else None
    if (
        tail is not None
        and tail.get("role") == "assistant"
        and isinstance(tail.get("content"), list)
    ):
        tail["content"].append(envelope)
    else:
        messages.append({"role": "assistant", "content": [envelope]})

    note = answer.get("message")
    if isinstance(note, str) and note.strip():
        messages.append({"role": "user", "content": note})

    return messages


class InteractionsDispatcher:
    """Respond-via-invoke logic. When dispatch_fn is supplied, fires detached (no blocking await)."""

    def __init__(
        self,
        *,
        workflows_service: WorkflowsService,
        interactions_service: SessionInteractionsService,
        records_service: Optional[RecordsService] = None,
        dispatch_fn: Optional[Callable] = None,
    ) -> None:
        self.workflows_service = workflows_service
        self.interactions_service = interactions_service
        self.records_service = records_service
        self._dispatch_fn = dispatch_fn

    async def _compose_inputs(
        self,
        *,
        project_id: UUID,
        interaction: SessionInteraction,
        answer: Any,
    ) -> Dict[str, Any]:
        if (
            interaction.kind == SessionInteractionKind.user_approval
            and isinstance(answer, dict)
            and isinstance(answer.get("approved"), bool)
        ):
            records: List[SessionRecord] = []
            if self.records_service is not None:
                try:
                    records = await self.records_service.get_records(
                        project_id=project_id,
                        session_id=interaction.session_id,
                    )
                except Exception as e:  # degrade to synthesized-anchor replay
                    log.warning(
                        "[interactions] records replay unavailable for "
                        f"session={interaction.session_id}: {e}"
                    )
            return {"messages": compose_approval_messages(records, interaction, answer)}

        return answer if isinstance(answer, dict) else {"value": answer}

    async def respond(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        interaction_id: UUID,
        answer: Any,
    ) -> None:
        interaction = await self.interactions_service.fetch_interaction(
            project_id=project_id,
            interaction_id=interaction_id,
        )

        data: Optional[SessionInteractionData] = interaction.data
        references = (
            {k: v.model_dump(mode="json") for k, v in data.references.items()}
            if data and data.references
            else None
        )
        selector = (
            data.selector.model_dump(mode="json") if data and data.selector else None
        )
        inputs = await self._compose_inputs(
            project_id=project_id,
            interaction=interaction,
            answer=answer,
        )

        invoke_request = WorkflowServiceRequest(
            references=references,
            selector=selector,
            data=WorkflowServiceRequestData(inputs=inputs),
            session_id=interaction.session_id,
        )

        if self._dispatch_fn is not None:
            # Detached path: hand off to the runner, return immediately.
            await self._dispatch_fn(
                project_id=project_id,
                user_id=user_id,
                request=invoke_request,
            )
            return

        await self.workflows_service.invoke_workflow(
            project_id=project_id,
            user_id=user_id,
            request=invoke_request,
        )
