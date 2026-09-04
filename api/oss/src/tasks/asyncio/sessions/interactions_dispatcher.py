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

The resume also carries the gated turn's own config when the runner stamped one on the row
(``data.parameters``): sending it inline suppresses reference hydration in the SDK resolver,
so the run continues under the config the gate was raised against rather than the referenced
variant's HEAD revision. A row written before that field existed has none, and the body is
byte-identical to the references-only one this dispatcher has always sent.

``references`` are not decoration on this request: they are how the invoke finds a service to
call at all (``WorkflowsService._ensure_request_revision`` resolves them into
``data.revision``, and ``_get_service_url`` reads the URL off it). A gate row whose
``data.references`` is empty therefore produces an invoke with no service URL, which fails
``Workflow revision has no runnable service URL.`` on every redelivery. The same identity is
also recorded on the session's turn and stream rows, so this dispatcher falls back to those
before giving up.
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
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.turns.dtos import SessionTurnQuery
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.core.sessions.types import SessionReference
from oss.src.core.workflows.dtos import (
    WorkflowServiceRequest,
    WorkflowServiceRequestData,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


# The reference keys `WorkflowsService._validate_execution_reference_families` accepts. A stored
# session reference list is untyped on purpose (a turn append is fire-and-forget, so rejecting an
# unknown family would drop the whole turn), which is why anything else is dropped here instead
# of being sent into a 400.
_EXECUTION_REFERENCE_KEYS = frozenset(
    {
        "workflow",
        "workflow_variant",
        "workflow_revision",
        "application",
        "application_variant",
        "application_revision",
        "evaluator",
        "evaluator_variant",
        "evaluator_revision",
    }
)


def keyed_references(
    elements: Optional[List[SessionReference]],
) -> Optional[Dict[str, Any]]:
    """Fold a stored flat reference list back into the keyed map an invoke carries.

    Sessions persist references as a flat list whose family lives in each element's ``key``
    (``session_turns.references``, ``session_streams.references``). An invoke carries the same
    identity as a map keyed by family, so the fold is the whole conversion.
    """
    if not elements:
        return None
    keyed: Dict[str, Any] = {}
    for element in elements:
        key = getattr(element, "key", None)
        if key not in _EXECUTION_REFERENCE_KEYS or key in keyed:
            continue
        reference = element.model_dump(mode="json", exclude_none=True)
        reference.pop("key", None)
        if reference:
            keyed[key] = reference
    return keyed or None


def _user_attachment_blocks(attributes: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Attachment blocks for one user record, in the runner's wire shape.

    Keys the runner omits when absent are omitted here too: a `null` filename is not the same
    wire value as no filename.
    """
    blocks: List[Dict[str, Any]] = []
    for attachment in attributes.get("attachments") or []:
        if not isinstance(attachment, dict):
            continue
        attachment_id = attachment.get("attachmentId")
        if not isinstance(attachment_id, str) or not attachment_id:
            continue
        block: Dict[str, Any] = {"type": "attachment", "attachmentId": attachment_id}
        for wire_key, stored_key in (
            ("filename", "filename"),
            ("mimeType", "mediaType"),
            ("size", "size"),
        ):
            value = attachment.get(stored_key)
            if value is not None:
                block[wire_key] = value
        blocks.append(block)
    return blocks


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
    # A tool_result record stores only the call id, but the runner's cold replay renders each
    # result as "[<toolName> returned: ...]" and matches approval nudges by tool name
    # (`approvalRenderHints`). Carry the name forward from the call, exactly as the runner's own
    # `reconstructMessages` does — without it every replayed result is an anonymous "tool".
    call_names: Dict[str, str] = {}

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
            raw_text = attributes.get("text")
            text = raw_text if isinstance(raw_text, str) else ""
            attachments = _user_attachment_blocks(attributes)
            if not text and not attachments:
                continue
            close_assistant()
            # Attachments ride the user record and rebuild as blocks followed by exactly one
            # text block, matching `services/runner/src/sessions/reconstruct.ts`. A turn that
            # was only files still replays: dropping it would hand the model a different
            # context than the one the human approved against.
            content: Any = (
                [*attachments, {"type": "text", "text": text}] if attachments else text
            )
            messages.append({"role": "user", "content": content})
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
                if attributes.get("id"):
                    call_names[attributes["id"]] = attributes["name"]
            if attributes.get("input") is not None:
                block["input"] = attributes["input"]
            assistant().append(block)
        elif record_type == "tool_result":
            block = {"type": "tool_result"}
            if attributes.get("id"):
                block["toolCallId"] = attributes["id"]
                if attributes["id"] in call_names:
                    block["toolName"] = call_names[attributes["id"]]
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
    carries the gated ``toolCallId``); else the id stored on the gate row itself; else the
    token (the runner's event id falls back to the tool-call id when the permission id is
    empty, so this stays a valid anchor for the synthesized-history path).

    The row is consulted before the token because warm-resume matching is strict on
    ``toolCallId``: whenever record replay lags or comes back empty, the token would miss the
    parked gate and drop an answerable turn to a cold replay for no reason. The row carries the
    harness call id from the moment the gate was created (`buildInteractionData`), so it is
    available even when no record is.
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

    stored_request = getattr(interaction.data, "request", None)
    stored = getattr(stored_request, "tool_call_id", None)
    if isinstance(stored, str) and stored:
        return stored

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
    request = data.request if data else None
    if request is None:
        return {"name": None, "args": None}
    return {"name": request.tool, "args": request.args}


def compose_approval_messages(
    records: List[SessionRecord],
    interaction: SessionInteraction,
    answer: Dict[str, Any],
) -> List[Dict[str, Any]]:
    return compose_approval_messages_many(records, [(interaction, answer)])


def compose_approval_messages_many(
    records: List[SessionRecord],
    interaction_answers: List[tuple[SessionInteraction, Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    """The full resume conversation: replayed history + the approval envelope.

    The envelope rides as a ``tool_result`` block on the LAST assistant message (never a
    new user message — the runner's history fingerprint counts user prompts, and the
    envelope's tool-call id dedupes against the already-present ``tool_call`` block, so a
    warm-parked sandbox still fingerprint-matches and resumes live). An optional
    deny-with-redirect ``message`` is appended as a trailing user message, which the
    fingerprint's prior-conversation slice excludes.

    Where that note is DELIVERED is asymmetric, and verified live (2026-07-30). A warm resume
    answers the parked harness gate on the still-pending original prompt and sends no new
    prompt (``run-turn.ts``: the resume branch reuses the parked ``promptPromise``), so the
    note never reaches the model — only a cold replay closes the replayed transcript with it.
    Fingerprint parity therefore makes the note undeliverable in the common case; mobile's
    steer control stays flag-gated off until the runner can carry a redirect in-band with the
    denial (#5444). The note is still persisted as a user record either way.
    """
    messages = build_wire_messages(records)
    notes: List[str] = []
    for interaction, answer in interaction_answers:
        gated_id = resolve_gated_tool_call_id(records, interaction, answer)
        gated_call = next(
            (
                block
                for message in messages
                if isinstance(message.get("content"), list)
                for block in message["content"]
                if block.get("type") == "tool_call"
                and block.get("toolCallId") == gated_id
            ),
            None,
        )
        shape = _gated_call_shape(records, interaction)
        if gated_call is None:
            # No durable tool_call record (e.g. records unavailable): synthesize the anchor the
            # runner's call-shape index needs to bind the envelope to name+args.
            gated_call = {"type": "tool_call", "toolCallId": gated_id}
            if shape.get("name"):
                gated_call["toolName"] = shape["name"]
            if shape.get("args") is not None:
                gated_call["input"] = shape["args"]
            messages.append({"role": "assistant", "content": [gated_call]})

        envelope = {
            "type": "tool_result",
            "toolCallId": gated_id,
            "output": {
                "approved": bool(answer.get("approved")),
                "interactionToken": interaction.token,
            },
        }
        gated_name = gated_call.get("toolName") or shape.get("name")
        if gated_name:
            envelope["toolName"] = gated_name
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
            notes.append(note)

    messages.extend({"role": "user", "content": note} for note in notes)

    return messages


class InteractionsDispatcher:
    """Respond-via-invoke logic. When dispatch_fn is supplied, fires detached (no blocking await)."""

    def __init__(
        self,
        *,
        workflows_service: WorkflowsService,
        interactions_service: SessionInteractionsService,
        records_service: Optional[RecordsService] = None,
        turns_service: Optional[SessionTurnsService] = None,
        streams_service: Optional[SessionStreamsService] = None,
        dispatch_fn: Optional[Callable] = None,
    ) -> None:
        self.workflows_service = workflows_service
        self.interactions_service = interactions_service
        self.records_service = records_service
        # Read-only, for the resume's reference fallback: the identity a session recorded on its
        # turn and stream rows when the gate row carries none.
        self.turns_service = turns_service
        self.streams_service = streams_service
        self._dispatch_fn = dispatch_fn

    async def _session_references(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[Dict[str, Any]]:
        """The session's own workflow identity, for a gate row that carries none.

        WHY THIS EXISTS. A resume is a server-side invoke, and the invoke resolves its service
        URL from the request's references (`WorkflowsService._ensure_request_revision` ->
        `_get_service_url`). A gate row written before `data.references` existed, or by a turn
        whose run context had no workflow identity yet, leaves the resume with nothing to
        resolve and the continuation fails `Workflow revision has no runnable service URL.`
        forever. The turn and stream rows of the SAME session carry the identity the platform
        resolved for that run, so read it from there rather than failing.

        Best effort by design: the resume is already durable, and a read that fails here must
        not turn into a failed continuation. A session that recorded no identity anywhere still
        cannot be resumed server-side; that case is the caller's to report.
        """
        if self.turns_service is not None:
            try:
                turns = await self.turns_service.query_turns(
                    project_id=project_id,
                    query=SessionTurnQuery(session_id=session_id),
                )
            except Exception as e:  # noqa: BLE001 - fallback read is best effort
                log.warning(
                    f"[interactions] turn references unavailable for session={session_id}: {e}"
                )
                turns = []
            for turn in turns or []:
                references = keyed_references(turn.references)
                if references:
                    return references

        if self.streams_service is not None:
            try:
                stream = await self.streams_service.fetch_header(
                    project_id=project_id,
                    session_id=session_id,
                )
            except Exception as e:  # noqa: BLE001 - fallback read is best effort
                log.warning(
                    f"[interactions] stream references unavailable for "
                    f"session={session_id}: {e}"
                )
                stream = None
            if stream is not None:
                return keyed_references(stream.references)

        return None

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
        control_command_id: Optional[UUID] = None,
        continuation_execution_id: Optional[str] = None,
    ) -> None:
        await self.respond_many(
            project_id=project_id,
            user_id=user_id,
            interaction_answers=[(interaction_id, answer)],
            control_command_id=control_command_id,
            continuation_execution_id=continuation_execution_id,
        )

    async def respond_many(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        interaction_answers: List[tuple[UUID, Any]],
        control_command_id: Optional[UUID] = None,
        continuation_execution_id: Optional[str] = None,
    ) -> None:
        resolved = [
            (
                await self.interactions_service.fetch_interaction(
                    project_id=project_id,
                    interaction_id=interaction_id,
                ),
                answer,
            )
            for interaction_id, answer in interaction_answers
        ]
        interaction, first_answer = resolved[0]

        data: Optional[SessionInteractionData] = interaction.data
        references = (
            {k: v.model_dump(mode="json") for k, v in data.references.items()}
            if data and data.references
            else await self._session_references(
                project_id=project_id,
                session_id=interaction.session_id,
            )
        )
        selector = (
            data.selector.model_dump(mode="json") if data and data.selector else None
        )
        if all(
            item.kind == SessionInteractionKind.user_approval
            and isinstance(answer, dict)
            and isinstance(answer.get("approved"), bool)
            for item, answer in resolved
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
            inputs = {"messages": compose_approval_messages_many(records, resolved)}
        else:
            inputs = await self._compose_inputs(
                project_id=project_id,
                interaction=interaction,
                answer=first_answer,
            )
        # The effective config the gated turn ran under, when the runner stamped one. Sending it
        # INLINE is what makes the resume correct: the resolver decides hydration purely from
        # what the caller sent (`_caller_supplied_configuration`), so inline parameters suppress
        # it and the run continues under the gated turn's own config instead of the referenced
        # variant's HEAD revision. References still ride along (attribution + the fallback for a
        # pre-change row, which has no parameters and keeps today's hydrating body verbatim).
        parameters = data.parameters if data else None

        invoke_request = WorkflowServiceRequest(
            references=references,
            selector=selector,
            data=WorkflowServiceRequestData(inputs=inputs, parameters=parameters),
            session_id=interaction.session_id,
        )
        if control_command_id is not None:
            invoke_request.meta = {
                **(invoke_request.meta or {}),
                "control_command_id": str(control_command_id),
            }

        if self._dispatch_fn is not None:
            # Detached path: hand off to the runner, return immediately.
            kwargs = {
                "project_id": project_id,
                "user_id": user_id,
                "request": invoke_request,
            }
            if continuation_execution_id is not None:
                kwargs["run_id"] = continuation_execution_id
            await self._dispatch_fn(**kwargs)
            return

        await self.workflows_service.invoke_workflow(
            project_id=project_id,
            user_id=user_id,
            request=invoke_request,
        )
