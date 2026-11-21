"""The session writes: `start_session`, `send_session_message`, `wait_for_sessions` and
`cancel_session` (design D3, D4, D7, D11 to D14, D29).

The calling agent and the calling session come from the run credential
(`SessionCaller`) and from nowhere else; these ops bind only the tool call id. The rules,
each in one place:

- `may_start` decides which agent a calling session may start, and `start_revision`
  which revision of it runs.
- `child_target` is the one "child of this calling session" check, in the order of
  design D23: a session that the run authority cannot see answers `session_not_found`,
  and only a visible session that is not a child answers `session_not_child`.
- `running_children` counts the running child sessions of one calling session, for the
  start and for a send that starts a turn.
- `wait_for_updates` is the one reader of child updates for the short wait and for
  `wait_for_sessions`: it takes the calling session's pending `child_update` rows by
  their structured part, returns their text, and sets them to `removed`.

A child turn runs with the calling turn's authority and sender, with the run origin
`calling_session`. Every message between sessions goes through `start_once` or
`enqueue_session_input` as plain text, so no approval answer can travel with it.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from time import monotonic
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence
from uuid import UUID

from agenta.sdk.agents.tools.models import ReferenceToolConfig, target_permission
from agenta.sdk.decorators.running import WorkflowServiceRequest

from oss.src.core.access.dtos import (
    DecisionReason,
    PrincipalKind,
    RunContext,
    RunEnvelope,
    RunOrigin,
)
from oss.src.core.access.context import fresh_request_memo
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.principals import access_denied_error
from oss.src.core.access.types import AccessDenied
from oss.src.core.sessions.child_updates.dtos import (
    ChildTurnAgent,
    ChildTurnError,
    ChildTurnResult,
    ChildTurnRevision,
    ChildTurnStatus,
    ChildTurnWaitingFor,
)
from oss.src.core.sessions.child_updates.form import (
    child_update_message,
    render_child_turn,
)
from oss.src.core.sessions.child_updates.service import still_running_schedule_id
from oss.src.core.sessions.commands.service import CANCELLED_BY_CALLING_SESSION
from oss.src.core.sessions.commands.types import ExecutionExpectationFailed
from oss.src.core.sessions.executions.senders import turn_first_execution
from oss.src.core.sessions.inputs.dtos import (
    PendingInput,
    PendingInputKind,
    PendingInputState,
)
from oss.src.core.sessions.interactions.dtos import (
    SessionInteractionQuery,
    SessionInteractionStatus,
)
from oss.src.core.sessions.interactions.references import keyed_references
from oss.src.core.sessions.records.dtos import TERMINAL_RECORD_TYPE
from oss.src.core.sessions.session_results import execution_endings
from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamQuery,
    SessionStreamQueryFlags,
)
from oss.src.core.sessions.turns.dtos import SessionTurn, SessionTurnQuery
from oss.src.core.sessions.types import (
    SessionCallingSession,
    SessionCallingSessionQuery,
)
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.sharing.admission import CHILD_RUN_BOUNDARY
from oss.src.core.sharing.dtos import (
    AccessPolicy,
    SessionGrant,
    SessionRole,
    Visibility,
)
from oss.src.core.sharing.service import get_sharing_service
from oss.src.core.tools.dtos import AgentError, PlatformHandlerResult
from oss.src.core.tools.exceptions import PlatformToolHandlerRefused
from oss.src.core.sessions.starts.types import SessionStartNotDurable
from oss.src.core.tools.platform_handlers import (
    START_SEND_TIMEOUT_MS,
    SessionCaller,
    _ArgumentsRefused,
    _FIND_AGENT_STEP,
    _Refusal,
    _agent_reference,
    _agent_refusal,
    _not_found,
    _parse_arguments,
    _refuse_unknown_arguments,
    caller_may,
)
from oss.src.core.triggers.dtos import TriggerScheduleSessionInput
from oss.src.core.workflows.static_catalog import is_builder_agent
from oss.src.dbs.redis.sessions.contract import validate_session_id
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


SHORT_WAIT_DEFAULT_MS = 20_000
SHORT_WAIT_MAX_MS = 60_000
WAIT_DEFAULT_MS = 300_000
WAIT_MIN_MS = 1_000
WAIT_MAX_MS = 600_000
WAIT_SESSIONS_MAX = 10
UPDATE_AFTER_MINUTES_MAX = 360
TEXT_MAX_CHARS = 40_000
SESSION_NAME_MAX_CHARS = 200

# A start or a send answers inside its tool call limit: the short wait gets only the
# time that the lock, the dispatch and the schedule left, less this reserve.
_CALL_RESERVE_MS = 5_000

# The waits read the calling session's queue once per second (design D4).
_POLL_SECONDS = 1.0
# A named child that no longer runs and has no update row: the producer writes the
# update about a second after the ending, with re-reads up to about two seconds. After
# this grace the wait answers with the child's current status, so it never waits the
# whole `wait_ms` for an update that was already delivered.
_SETTLED_GRACE_SECONDS = 5.0

STILL_RUNNING_EVENT_KEY = "still_running"
START_KEY_PREFIX = "ag:start:"
SEND_KEY_PREFIX = "ag:send:"

SESSION_DEPTH_LIMIT_REACHED = "session_depth_limit_reached"
CHILD_SESSION_LIMIT_REACHED = "child_session_limit_reached"
CHILD_QUEUE_LIMIT_REACHED = "child_queue_limit_reached"
SESSION_NOT_CHILD = "session_not_child"
AGENT_NOT_ALLOWED = "agent_not_allowed"
# Not in design D29: the server finds no turn row for the calling turn, so it cannot
# name the child update's turn or the calling record.
CALLING_TURN_NOT_FOUND = "calling_turn_not_found"

_START_FIELDS = (
    "agent",
    "text",
    "name",
    "wait_ms",
    "update_after_minutes",
    "tool_call_id",
)
_SEND_FIELDS = ("session_id", "text", "wait_ms", "update_after_minutes", "tool_call_id")
_WAIT_FIELDS = ("session_ids", "wait_ms")
_CANCEL_FIELDS = ("session_id",)


@dataclass
class SessionWriteServices:
    """What the session write handlers read and write. Built once in the API
    composition and handed to the tools router."""

    streams_dao: Any
    executions_dao: Any
    inputs_dao: Any
    turns_dao: Any
    interactions_service: Any
    records_service: Any
    starts_service: Any
    commands_service: Any
    triggers_service: Any
    workflows_service: Any
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep
    clock: Callable[[], float] = monotonic


# -- refusals (design D29) ----------------------------------------------------------------


def _refusal(
    code: str,
    message: str,
    next_step: Optional[str],
    *,
    retryable: bool = False,
    details: Optional[Dict[str, Any]] = None,
) -> _Refusal:
    return _Refusal(
        AgentError(
            code=code,
            message=message,
            retryable=retryable,
            next_step=next_step,
            details=details,
        )
    )


def _session_not_found(session_id: str) -> _Refusal:
    return _refusal(
        "session_not_found",
        f"No session with the id '{session_id}' is visible to this agent.",
        "Check the id with `list_sessions`.",
    )


def _session_not_child(session_id: str) -> _Refusal:
    return _refusal(
        SESSION_NOT_CHILD,
        f"The session '{session_id}' was not started by this session.",
        "Read it with `read_session`, or start a new session.",
    )


def _session_depth_limit_reached(limit: int) -> _Refusal:
    return _refusal(
        SESSION_DEPTH_LIMIT_REACHED,
        f"This session is {limit} levels below the session that a person started, "
        f"and a child session may be at most {limit} levels deep.",
        "Do the work yourself in this session.",
        details={"limit": limit},
    )


async def check_session_depth(
    services: SessionWriteServices, *, project_id: UUID, stream: SessionStream
) -> None:
    """Refuse a start when the new child would be deeper than the depth limit. The
    level of a session is the number of calling sessions above it, read up the chain of
    `calling_session` records: at most the limit less one reads. A calling session row
    that is gone ends the chain."""
    limit = env.agenta.sessions.child_session_depth_limit
    level = 0
    current: Optional[SessionStream] = stream
    while current is not None and current.calling_session is not None:
        level += 1
        if level >= limit:
            raise _session_depth_limit_reached(limit)
        current = await services.streams_dao.get_by_session_id(
            project_id=project_id, session_id=current.calling_session.id
        )


def _calling_turn_not_found(message: str) -> _Refusal:
    return _refusal(
        CALLING_TURN_NOT_FOUND,
        message,
        "Try again in a moment; if it fails again, do the work in this session.",
        retryable=True,
    )


DISPATCH_NOT_CONFIRMED = "dispatch_not_confirmed"


def _dispatch_not_confirmed(*, is_start: bool) -> _Refusal:
    """The lock or the dispatch of a start or a send could not be confirmed. The work
    may have started, so the next step names the read that tells."""
    if is_start:
        return _refusal(
            DISPATCH_NOT_CONFIRMED,
            "The server could not confirm that the child session started.",
            "Check with `list_sessions` whether it started before you call this again.",
            retryable=True,
        )
    return _refusal(
        DISPATCH_NOT_CONFIRMED,
        "The server could not confirm that the message reached the child session.",
        "Check with `read_session` whether the child got it before you send it again.",
        retryable=True,
    )


def _agent_not_allowed(raw: str, allowed: Sequence[str]) -> _Refusal:
    return _refusal(
        AGENT_NOT_ALLOWED,
        f"This agent may not start or message '{raw}'.",
        "Pick one of the allowed agents, or do the work yourself.",
        details={"allowed_agents": list(allowed)},
    )


def _access_denied_private() -> _Refusal:
    """A child copies this session's sharing: its policy and, when private, the people
    named on it. A child of a private session runs only for the owner or a participant:
    not for another person who sent the turn, and not for a channel installation."""
    return _refusal(
        "access_denied",
        "This session is private to its owner, so a session that it starts would be "
        "private to the owner too, and this turn does not run for the owner.",
        "Do the work in this session, or ask the owner to share this session with the "
        "project and then try again.",
        details={"reason": DecisionReason.RESOURCE_DENIED.value},
    )


def _access_denied_from(caller: SessionCaller, error: AccessDenied) -> AgentError:
    return access_denied_error(
        decision=error.decision,
        principal_kind=caller.envelope.authority.principal.kind,
        project_id=caller.envelope.authority.project_id,
    )


# -- arguments ----------------------------------------------------------------------------


def _text_argument(arguments: Dict[str, Any]) -> str:
    text = arguments.get("text")
    if not isinstance(text, str) or not text.strip():
        raise _ArgumentsRefused(
            "`text` is required: the message for the session.",
            next_step="Send `text` as a non-empty string.",
        )
    if len(text) > TEXT_MAX_CHARS:
        raise _ArgumentsRefused(
            f"`text` is longer than {TEXT_MAX_CHARS} characters.",
            next_step="Send a shorter `text`, or put the long part in a file.",
        )
    return text


def _int_argument(
    arguments: Dict[str, Any], field: str, *, default: int, minimum: int, maximum: int
) -> int:
    value = arguments.get(field, default)
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not minimum <= value <= maximum
    ):
        raise _ArgumentsRefused(
            f"`{field}` must be a whole number from {minimum} to {maximum}.",
            next_step=f"Omit `{field}` to use {default}.",
        )
    return value


def _update_after_minutes(arguments: Dict[str, Any]) -> int:
    return _int_argument(
        arguments,
        "update_after_minutes",
        default=min(
            env.agenta.sessions.still_running_update_minutes, UPDATE_AFTER_MINUTES_MAX
        ),
        minimum=1,
        maximum=UPDATE_AFTER_MINUTES_MAX,
    )


def _short_wait_ms(arguments: Dict[str, Any]) -> int:
    return _int_argument(
        arguments,
        "wait_ms",
        default=SHORT_WAIT_DEFAULT_MS,
        minimum=0,
        maximum=SHORT_WAIT_MAX_MS,
    )


def _tool_call_id(arguments: Dict[str, Any]) -> str:
    """Bound from the run (`$ctx.tool.call_id`); a missing one is our bug, not the
    model's, so it is not answered as an argument error."""
    raw = arguments.get("tool_call_id")
    if not isinstance(raw, str) or not raw.strip():
        raise PlatformToolHandlerRefused(
            "tool_call_id is bound from the run and was missing."
        )
    return raw.strip()


def _session_id_value(raw: Any, *, field: str = "session_id") -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise _ArgumentsRefused(
            f"`{field}` is required: the `session_id` of a child session.",
            next_step="Take the `session_id` from the result of `start_session`.",
        )
    return raw.strip()


def _check_project(caller: SessionCaller, project_id: UUID) -> None:
    if caller.envelope.authority.project_id != project_id:
        raise _refusal(
            "run_credential_required",
            "The run credential belongs to another project than this request.",
            None,
        )


# -- the calling turn ---------------------------------------------------------------------


@dataclass(frozen=True)
class CallingTurn:
    """The calling session as the session writes need it, read by the server."""

    stream: SessionStream
    # The execution that runs in the calling session now (`session_streams.turn_id`).
    execution_id: str
    # The calling turn's first execution: the id of its `session_turns` row.
    first_execution_id: str
    turn: SessionTurn


async def calling_turn(
    *, services: SessionWriteServices, caller: SessionCaller, project_id: UUID
) -> CallingTurn:
    """The calling turn, resolved once while it runs (design D5). The first execution
    comes from the one walk of design D34, so a call after an approval names the turn's
    first execution, not the continuation. Refused when the calling session has no
    turn row for it: the producer could not name the update turn's origin."""
    stream = await services.streams_dao.get_by_session_id(
        project_id=project_id, session_id=caller.run_session_id
    )
    if stream is None or not stream.turn_id:
        raise _calling_turn_not_found(
            "This session has no running turn that the server knows of."
        )
    execution_id = stream.turn_id
    first_id = execution_id
    execution = await services.executions_dao.fetch_execution(
        project_id=project_id,
        session_id=caller.run_session_id,
        execution_id=execution_id,
    )
    if execution is not None:
        # A first execution can have no row until it settles; a continuation has one.
        first = await turn_first_execution(
            executions_dao=services.executions_dao,
            project_id=project_id,
            session_id=caller.run_session_id,
            execution=execution,
        )
        if first is None:
            raise _calling_turn_not_found(
                "The server cannot find the first step of this turn."
            )
        first_id = first.execution_id
    try:
        turn_uuid = UUID(first_id)
    except ValueError:
        turn_uuid = None
    turn = (
        await services.turns_dao.find_turn(
            project_id=project_id, session_id=caller.run_session_id, turn_id=turn_uuid
        )
        if turn_uuid is not None
        else None
    )
    if turn is None:
        raise _calling_turn_not_found(
            "This turn has no stored turn record yet, so the server cannot report "
            "back to it.",
        )
    return CallingTurn(
        stream=stream,
        execution_id=execution_id,
        first_execution_id=first_id,
        turn=turn,
    )


def _reference_id(references: Optional[Sequence[Any]], key: str) -> Optional[UUID]:
    for reference in references or ():
        if getattr(reference, "key", None) == key and getattr(reference, "id", None):
            return reference.id
    return None


def calling_revision_id(turn: SessionTurn) -> Optional[UUID]:
    """The committed revision that the calling turn ran, or None for a turn that names
    none (a draft run)."""
    return _reference_id(turn.references, "workflow_revision") or _reference_id(
        turn.references, "application_revision"
    )


async def subagent_entries(
    *, services: SessionWriteServices, project_id: UUID, turn: SessionTurn
) -> List[ReferenceToolConfig]:
    """The Subagent entries of the calling revision, read from the calling turn's
    references. A turn that names no committed revision gives no entries, so a
    configured agent may then start only its own agent (fails closed)."""
    revision_id = calling_revision_id(turn)
    if revision_id is None:
        return []
    revision = await services.workflows_service.fetch_workflow_revision(
        project_id=project_id, workflow_revision_ref=Reference(id=revision_id)
    )
    data = getattr(revision, "data", None) if revision is not None else None
    parameters = getattr(data, "parameters", None) if data is not None else None
    agent = parameters.get("agent") if isinstance(parameters, dict) else None
    tools = agent.get("tools") if isinstance(agent, dict) else None
    entries: List[ReferenceToolConfig] = []
    for tool in tools if isinstance(tools, list) else ():
        if not isinstance(tool, dict) or tool.get("type") != "reference":
            continue
        try:
            entries.append(ReferenceToolConfig.model_validate(tool))
        except ValueError:
            continue  # the resolver drops a malformed entry too
    return entries


def _entry_for(
    entries: Sequence[ReferenceToolConfig], slug: Optional[str]
) -> Optional[ReferenceToolConfig]:
    if not slug:
        return None
    for entry in entries:
        if entry.slug == slug:
            return entry
    return None


def _denied(entry: Optional[ReferenceToolConfig]) -> bool:
    """`target_permission` for the target, at the handler. The tool's own `deny` never
    reaches a handler (the runner refuses the call), so the tool side counts as
    `allow` here and only the entry's permission can make it stricter."""
    return entry is not None and target_permission("allow", entry.permission) == "deny"


# -- may_start and the revision (design D12, D13) ------------------------------------------


@dataclass(frozen=True)
class StartTarget:
    workflow: Any
    entry: Optional[ReferenceToolConfig]


async def may_start(
    *,
    services: SessionWriteServices,
    caller: SessionCaller,
    project_id: UUID,
    arguments: Dict[str, Any],
    entries: Sequence[ReferenceToolConfig],
) -> StartTarget:
    """The one decision of which agent a calling session may start.

    No caller starts a static workflow, the builder included (`agent_is_static`). An
    agent that the run authority may not run reads as unknown (`agent_not_found`). The
    builder starts any other agent. Any other agent starts its own agent and the agents
    that its Subagent entries name, except a target whose entry permission is `deny`
    (`agent_not_allowed`)."""
    from oss.src.core.tools.gate import may_run_agent  # noqa: PLC0415

    workflows = services.workflows_service
    raw, reference = _agent_reference(arguments)
    head = await workflows.fetch_workflow_revision(
        project_id=project_id, workflow_ref=reference, include_archived=False
    )
    if head is not None and head.flags is not None and head.flags.is_static:
        raise _agent_refusal(
            "agent_is_static",
            f"'{raw}' is a built-in Agenta workflow, not an agent you can start.",
            _FIND_AGENT_STEP,
        )
    workflow = await workflows.fetch_workflow(
        project_id=project_id,
        workflow_ref=(
            Reference(id=head.workflow_id)
            if head is not None and head.workflow_id is not None
            else reference
        ),
        include_archived=True,
    )
    if workflow is None or workflow.id is None:
        raise _not_found(raw)
    if not await may_run_agent(envelope=caller.envelope, agent_id=workflow.id):
        raise _not_found(raw)
    if workflow.deleted_at is not None:
        raise _agent_refusal(
            "agent_is_archived",
            f"'{workflow.name or raw}' is archived. An archived agent cannot be started.",
            "Pick an agent that is not archived: call list_agents.",
        )
    if head is None:
        raise _not_found(raw)
    if head.flags is None or not head.flags.is_agent:
        raise _agent_refusal(
            "workflow_is_not_agent",
            f"'{workflow.name or raw}' is a workflow, not an agent.",
            _FIND_AGENT_STEP,
        )

    if is_builder_agent(caller.run_agent_id):
        return StartTarget(workflow=workflow, entry=None)
    entry = _entry_for(entries, workflow.slug)
    is_own = caller.run_agent_id is not None and workflow.id == caller.run_agent_id
    if (not is_own and entry is None) or _denied(entry):
        raise _agent_not_allowed(
            raw, await _allowed_agents(services, caller, project_id, entries)
        )
    return StartTarget(workflow=workflow, entry=entry)


async def _allowed_agents(
    services: SessionWriteServices,
    caller: SessionCaller,
    project_id: UUID,
    entries: Sequence[ReferenceToolConfig],
) -> List[str]:
    """The slugs this agent may start: its own and those of its Subagent entries that
    are not `deny`."""
    allowed: List[str] = []
    if caller.run_agent_id is not None:
        own = await services.workflows_service.fetch_workflow(
            project_id=project_id,
            workflow_ref=Reference(id=caller.run_agent_id),
            include_archived=True,
        )
        if own is not None and own.slug:
            allowed.append(own.slug)
    for entry in entries:
        if not _denied(entry) and entry.slug not in allowed:
            allowed.append(entry.slug)
    return allowed


@dataclass(frozen=True)
class StartRevision:
    id: UUID
    version: Optional[str]


async def start_revision(
    *, services: SessionWriteServices, project_id: UUID, target: StartTarget
) -> StartRevision:
    """The revision a child session runs (design D13): the one the Subagent entry pins,
    resolved as the blocking call resolves it, else the latest revision of the agent's
    default variant."""
    workflow = target.workflow
    entry = target.entry
    if entry is not None and entry.ref_by == "environment":
        references = {
            "environment": Reference(slug=entry.environment),
            "workflow": Reference(slug=entry.slug),
        }
    elif entry is not None and entry.version:
        references = {"workflow": Reference(slug=entry.slug, version=entry.version)}
    else:
        references = {"workflow": Reference(id=workflow.id)}
    resolved = await services.workflows_service.resolve_request_target(
        project_id=project_id,
        request=WorkflowServiceRequest(references=references),
    )
    if resolved is None or resolved.artifact_id != workflow.id:
        raise _agent_refusal(
            "agent_not_found",
            f"'{workflow.slug}' has no revision that this agent may run"
            + (" at its pinned version." if entry is not None else "."),
            _FIND_AGENT_STEP,
        )
    revision = await services.workflows_service.fetch_workflow_revision(
        project_id=project_id, workflow_revision_ref=Reference(id=resolved.revision_id)
    )
    version = getattr(revision, "version", None) if revision is not None else None
    return StartRevision(
        id=resolved.revision_id,
        version=str(version) if version is not None else None,
    )


# -- children of the calling session -------------------------------------------------------


async def child_target(
    *,
    services: SessionWriteServices,
    caller: SessionCaller,
    project_id: UUID,
    session_id: str,
    action: Permission,
) -> SessionStream:
    """The one "child of this calling session" check, in the order of design D23. A
    session the run authority cannot see, or may not act on, answers
    `session_not_found`, so the error never says that a hidden session exists."""
    if not validate_session_id(session_id):
        raise _session_not_found(session_id)
    if not await caller_may(
        caller, session_id=session_id, action=Permission.VIEW_SESSIONS
    ):
        raise _session_not_found(session_id)
    stream = await services.streams_dao.get_by_session_id(
        project_id=project_id, session_id=session_id
    )
    if stream is None:
        raise _session_not_found(session_id)
    if (
        stream.calling_session is None
        or stream.calling_session.id != caller.run_session_id
    ):
        raise _session_not_child(session_id)
    if action == Permission.RUN_SESSIONS and not await caller_may(
        caller, session_id=session_id, action=Permission.RUN_SESSIONS
    ):
        raise _session_not_found(session_id)
    return stream


async def running_children(
    *,
    services: SessionWriteServices,
    caller: SessionCaller,
    project_id: UUID,
    exclude: Optional[str] = None,
) -> List[str]:
    """The child sessions of the calling session that run a turn now, at most one more
    than the cap. The one count of the running cap, for a start and for a send that
    starts a turn."""
    cap = env.agenta.sessions.child_sessions_limit
    results = await services.streams_dao.query(
        project_id=project_id,
        read_scope=await get_sharing_service().session_read_scope(
            project_id=project_id, principal=caller.envelope.authority.principal
        ),
        filter=SessionStreamQuery(
            calling_session=SessionCallingSessionQuery(ids=[caller.run_session_id]),
            flags=SessionStreamQueryFlags(is_running=True),
            include_archived=True,
        ),
        windowing=Windowing(limit=cap + 1),
    )
    return [
        result.stream.session_id
        for result in results
        if result.stream.session_id != exclude
    ]


def _check_running_cap(running: List[str]) -> None:
    cap = env.agenta.sessions.child_sessions_limit
    if len(running) >= cap:
        raise _refusal(
            CHILD_SESSION_LIMIT_REACHED,
            f"This session already has {cap} running child sessions, the most it may "
            "have.",
            "Wait for a child with `wait_for_sessions`, or cancel one, then try again.",
            retryable=True,
            details={"limit": cap, "running_sessions": running[:cap]},
        )


def _queued_from_caller(pending: Sequence[PendingInput], caller: SessionCaller) -> int:
    """The messages that this calling session queued in a child and that still wait."""
    count = 0
    for row in pending:
        envelope = row.run_envelope
        if (
            row.state == PendingInputState.pending
            and row.kind == PendingInputKind.message
            and envelope is not None
            and envelope.context.origin == RunOrigin.CALLING_SESSION
            and envelope.context.origin_id == caller.run_session_id
        ):
            count += 1
    return count


async def _pending_interactions(
    services: SessionWriteServices, project_id: UUID, session_id: str
) -> List[Any]:
    return list(
        await services.interactions_service.query_interactions(
            project_id=project_id,
            query=SessionInteractionQuery(
                session_id=session_id, status=SessionInteractionStatus.pending
            ),
        )
    )


def child_envelope(*, caller: SessionCaller, calling_execution_id: str) -> RunEnvelope:
    """The envelope of a turn that the calling session sends into a child: the calling
    turn's authority and sender, the run origin `calling_session`, and the calling
    execution as its parent. It approves nothing."""
    return RunEnvelope(
        authority=caller.envelope.authority,
        sender=caller.envelope.sender,
        context=RunContext(
            origin=RunOrigin.CALLING_SESSION,
            origin_id=caller.run_session_id,
            parent_run_id=calling_execution_id,
        ),
        approved_by=None,
    )


def _authority_may_run(
    policy: AccessPolicy, grants: Sequence[SessionGrant], caller: SessionCaller
) -> bool:
    """Whether the run authority may run a new session with this copied policy and
    these copied grants. A private copy runs for its owner and for a participant; an
    installation (a private agent's channel session) never runs it, and the start
    fails closed."""
    if policy.visibility != Visibility.PRIVATE:
        return True
    principal = caller.envelope.authority.principal
    if principal.kind != PrincipalKind.HUMAN:
        return False
    return principal.id == policy.owner_user_id or any(
        grant.user_id == principal.id and grant.role == SessionRole.PARTICIPANT
        for grant in grants
    )


# -- child updates: the one reader of the waits (design D4) ------------------------------


@dataclass(frozen=True)
class _UpdateRow:
    row: PendingInput
    child_session_id: str
    turn_id: Optional[str]
    text: str


def _update_rows(
    pending: Sequence[PendingInput], children: Sequence[str]
) -> List[_UpdateRow]:
    """The calling session's pending child updates for these children that report an
    ending or a pause, read from their structured part only, never from the key or the
    text. A still-running update (`status: running`) never ends a wait."""
    wanted = set(children)
    found: List[_UpdateRow] = []
    for row in pending:
        if (
            row.state != PendingInputState.pending
            or row.kind != PendingInputKind.child_update
        ):
            continue
        messages = (((row.content or {}).get("data") or {}).get("inputs") or {}).get(
            "messages"
        ) or []
        for message in messages if isinstance(messages, list) else ():
            part = message.get("child_update") if isinstance(message, dict) else None
            if not isinstance(part, dict):
                continue
            session_id = part.get("session_id")
            status = part.get("status")
            text = message.get("content")
            if (
                session_id in wanted
                and isinstance(status, str)
                and status != ChildTurnStatus.running.value
                and isinstance(text, str)
            ):
                found.append(
                    _UpdateRow(
                        row=row,
                        child_session_id=session_id,
                        turn_id=part.get("turn_id"),
                        text=text,
                    )
                )
                break
    return found


async def _consume(
    services: SessionWriteServices,
    *,
    project_id: UUID,
    user_id: UUID,
    session_id: str,
    rows: Sequence[_UpdateRow],
) -> Dict[str, str]:
    """Set each row to `removed`, as the person's remove does, and return the text of
    every row this call removed, in queue order, by child: a child that ended two
    turns gives both updates, so no removed update is lost. A row that a settle
    promoted a moment before is not returned; it runs as a turn instead."""
    texts: Dict[str, List[str]] = {}
    for update in rows:
        try:
            removed = await services.inputs_dao.remove_pending(
                project_id=project_id,
                session_id=session_id,
                input_id=update.row.id,
                user_id=user_id,
            )
        except Exception:  # noqa: BLE001 - the row stays pending for a later read
            log.warning(
                "[SESSION-TOOLS] child update not removed",
                project_id=str(project_id),
                session_id=session_id,
                input_id=str(update.row.id),
                exc_info=True,
            )
            continue
        if removed is not None:
            texts.setdefault(update.child_session_id, []).append(update.text)
    return {child: "\n\n".join(blocks) for child, blocks in texts.items()}


async def wait_for_updates(
    services: SessionWriteServices,
    *,
    project_id: UUID,
    user_id: UUID,
    calling_session_id: str,
    children: Sequence[str],
    wait_ms: int,
    turn_ids: Optional[Dict[str, str]] = None,
    settled: Optional[Callable[[], Awaitable[List[str]]]] = None,
) -> Dict[str, str]:
    """Read the calling session's queue once per second until a named child has an
    update that reports an ending or a pause, or `wait_ms` passes. Returns the text of
    each update that it consumed, by child session.

    `turn_ids` limits a child to the update of one turn (the short wait: the turn that
    the call started). `settled` names the children that no longer run; when one of
    them has had no update for the grace, the wait ends, because its update was
    delivered before."""
    deadline = services.clock() + wait_ms / 1000
    settled_since: Dict[str, float] = {}
    while True:
        pending = await services.inputs_dao.list_pending(
            project_id=project_id, session_id=calling_session_id
        )
        rows = [
            row
            for row in _update_rows(pending, children)
            if turn_ids is None
            or turn_ids.get(row.child_session_id) in (None, row.turn_id)
        ]
        if rows:
            texts = await _consume(
                services,
                project_id=project_id,
                user_id=user_id,
                session_id=calling_session_id,
                rows=rows,
            )
            if texts:
                return texts
        now = services.clock()
        if settled is not None:
            idle = set(await settled())
            for child in list(settled_since):
                if child not in idle:
                    settled_since.pop(child)
            for child in idle:
                settled_since.setdefault(child, now)
            if any(
                now - since >= _SETTLED_GRACE_SECONDS
                for since in settled_since.values()
            ):
                return {}
        remaining = deadline - now
        if remaining <= 0:
            return {}
        await services.sleep(min(_POLL_SECONDS, remaining))


# -- the still-running update (design D7) ----------------------------------------------


async def schedule_still_running(
    services: SessionWriteServices,
    *,
    project_id: UUID,
    user_id: UUID,
    caller: SessionCaller,
    calling: CallingTurn,
    child_session_id: str,
    child_input_id: UUID,
    child_execution_id: Optional[str],
    child_turn_id: Optional[str],
    agent: Optional[ChildTurnAgent],
    revision: Optional[ChildTurnRevision],
    minutes: int,
) -> None:
    """Create the one hidden one-time schedule that sends the still-running update into
    the calling session after `minutes`. Its id comes from the project, the calling
    session and the child input, so a retried call creates nothing new and the producer
    deletes it by the same id.

    The producer deletes it when the child's turn ends or pauses. When that happened
    before the schedule existed, the producer found nothing to delete, so the schedule
    is removed here. A queued message (no execution yet) is read again after the
    create: the queue may have promoted it, and its turn may have ended, in the
    meantime. A failure is logged: the still-running update is a reminder, and
    the call already started the child's turn."""
    schedule_id = still_running_schedule_id(
        project_id=project_id,
        calling_session_id=caller.run_session_id,
        child_input_id=child_input_id,
    )
    update = ChildTurnResult(
        session_id=child_session_id,
        agent=agent,
        revision=revision,
        status=ChildTurnStatus.running,
        turn_id=child_turn_id,
    )
    content = {
        "session_id": caller.run_session_id,
        # The calling turn's revision, and the agent from the session row when the
        # turn row names only the revision: the fire checks `RUN_WORKFLOWS` on it.
        "references": {
            **(keyed_references(calling.stream.references) or {}),
            **(keyed_references(calling.turn.references) or {}),
        },
        "data": {"inputs": {"messages": [child_update_message(update)]}},
    }
    try:
        await services.triggers_service.create_session_schedule(
            project_id=project_id,
            user_id=user_id,
            schedule_id=schedule_id,
            event_key=STILL_RUNNING_EVENT_KEY,
            run_at=datetime.now(timezone.utc) + timedelta(minutes=minutes),
            session_id=caller.run_session_id,
            session_input=TriggerScheduleSessionInput(
                kind=PendingInputKind.child_update, content=content
            ),
            # The calling turn's authority and sender; the triggers service sets the
            # origin `schedule` and the schedule id.
            run_envelope=RunEnvelope(
                authority=caller.envelope.authority,
                sender=caller.envelope.sender,
                context=RunContext(origin=RunOrigin.SCHEDULE),
            ),
        )
        if child_execution_id is None:
            queued = await services.inputs_dao.fetch_input(
                project_id=project_id,
                session_id=child_session_id,
                input_id=child_input_id,
            )
            child_execution_id = (
                queued.promoted_execution_id if queued is not None else None
            )
        if child_execution_id is not None and await _execution_reported(
            services,
            project_id=project_id,
            session_id=child_session_id,
            execution_id=child_execution_id,
        ):
            await services.triggers_service.purge_session_schedule(
                project_id=project_id, schedule_id=schedule_id
            )
    except Exception:  # noqa: BLE001 - the child runs either way
        log.warning(
            "[SESSION-TOOLS] still-running schedule not created",
            project_id=str(project_id),
            calling_session_id=caller.run_session_id,
            child_session_id=child_session_id,
            exc_info=True,
        )


async def _execution_reported(
    services: SessionWriteServices,
    *,
    project_id: UUID,
    session_id: str,
    execution_id: str,
) -> bool:
    """Whether the producer can already see the child execution's ending or pause: it
    settled, or it wrote its `done` record. The producer deletes the schedule only
    after it sees one of them."""
    execution = await services.executions_dao.fetch_execution(
        project_id=project_id, session_id=session_id, execution_id=execution_id
    )
    if execution is not None and execution.terminal_outcome is not None:
        return True
    records = await services.records_service.get_ending_records_of_executions(
        project_id=project_id, session_ids=[session_id], execution_ids=[execution_id]
    )
    return any(record.record_type == TERMINAL_RECORD_TYPE for record in records)


# -- result blocks ------------------------------------------------------------------------


async def _agent_of(
    services: SessionWriteServices, project_id: UUID, stream: SessionStream
) -> Optional[ChildTurnAgent]:
    agent_id = _reference_id(stream.references, "workflow") or _reference_id(
        stream.references, "application"
    )
    if agent_id is None:
        return None
    workflow = await services.workflows_service.fetch_workflow(
        project_id=project_id,
        workflow_ref=Reference(id=agent_id),
        include_archived=True,
    )
    if workflow is None or workflow.id is None:
        return ChildTurnAgent(id=agent_id)
    return ChildTurnAgent(id=workflow.id, slug=workflow.slug, name=workflow.name)


async def _newest_turn_id(
    services: SessionWriteServices, project_id: UUID, session_id: str
) -> Optional[str]:
    turns = await services.turns_dao.query_turns(
        project_id=project_id, query=SessionTurnQuery(session_id=session_id)
    )
    newest = max(turns, key=lambda turn: turn.turn_index, default=None)
    return str(newest.turn_id) if newest is not None and newest.turn_id else None


async def current_block(
    services: SessionWriteServices, *, project_id: UUID, stream: SessionStream
) -> str:
    """The marked block of a child for which no update was consumed: its current
    status, from the session row, its pending interactions and the ending of its
    newest execution. It carries no last message; that comes with the update."""
    interactions = await _pending_interactions(services, project_id, stream.session_id)
    waiting_for = None
    ending = None
    if interactions:
        status = ChildTurnStatus.paused
        waiting_for = [
            ChildTurnWaitingFor(
                interaction_id=str(item.id) if item.id else None,
                kind=item.kind.value,
                tool=(
                    item.data.request.tool if item.data and item.data.request else None
                ),
            )
            for item in interactions
        ]
    elif stream.flags.is_running or not stream.turn_id:
        status = ChildTurnStatus.running
    else:
        endings = execution_endings(
            await services.records_service.get_ending_records_of_executions(
                project_id=project_id,
                session_ids=[stream.session_id],
                execution_ids=[stream.turn_id],
            )
        )
        ending = endings.get(stream.turn_id)
        status = (
            ChildTurnStatus(ending.status.value)
            if ending is not None
            else ChildTurnStatus.running
        )
    return render_child_turn(
        ChildTurnResult(
            session_id=stream.session_id,
            agent=await _agent_of(services, project_id, stream),
            status=status,
            turn_id=await _newest_turn_id(services, project_id, stream.session_id),
            # The same companion fields as the child update of this ending.
            cancelled_by=(
                ending.cancelled_by.value
                if ending is not None and ending.cancelled_by is not None
                else None
            ),
            error=(
                ChildTurnError(**ending.error)
                if ending is not None and ending.error
                else None
            ),
            waiting_for=waiting_for,
        )
    )


def _running_block(
    *,
    session_id: str,
    agent: Optional[ChildTurnAgent],
    revision: Optional[ChildTurnRevision],
    turn_id: Optional[str],
) -> str:
    return render_child_turn(
        ChildTurnResult(
            session_id=session_id,
            agent=agent,
            revision=revision,
            status=ChildTurnStatus.running,
            turn_id=turn_id,
        )
    )


def _remaining_wait_ms(
    services: SessionWriteServices, *, started_at: float, wait_ms: int
) -> int:
    """The short wait that still fits in the call: `wait_ms`, cut to the tool call
    limit less the time this call already used and a reserve for the answer."""
    used_ms = int((services.clock() - started_at) * 1000)
    return max(0, min(wait_ms, START_SEND_TIMEOUT_MS - _CALL_RESERVE_MS - used_ms))


def _queued_result(session_id: str) -> Dict[str, str]:
    """A send whose message waits in the child's queue names no turn yet."""
    return {"session_id": session_id, "status": ChildTurnStatus.running.value}


# -- start_session ------------------------------------------------------------------------


async def _stored_revision(
    services: SessionWriteServices,
    *,
    project_id: UUID,
    started: Any,
    fallback: StartRevision,
) -> StartRevision:
    """The revision that a start stored on its first input."""
    stored = await services.inputs_dao.fetch_input(
        project_id=project_id, session_id=started.session_id, input_id=started.input_id
    )
    references = (stored.content or {}).get("references") if stored else None
    raw = ((references or {}).get("workflow_revision") or {}).get("id")
    try:
        revision_id = UUID(str(raw))
    except ValueError:
        return fallback
    if revision_id == fallback.id:
        return fallback
    revision = await services.workflows_service.fetch_workflow_revision(
        project_id=project_id, workflow_revision_ref=Reference(id=revision_id)
    )
    version = getattr(revision, "version", None) if revision is not None else None
    return StartRevision(
        id=revision_id, version=str(version) if version is not None else None
    )


def start_key(
    *, calling_session_id: str, calling_execution_id: str, tool_call_id: str
) -> str:
    return (
        f"{START_KEY_PREFIX}{calling_session_id}:{calling_execution_id}:{tool_call_id}"
    )


def send_key(
    *, calling_session_id: str, calling_execution_id: str, tool_call_id: str
) -> str:
    return (
        f"{SEND_KEY_PREFIX}{calling_session_id}:{calling_execution_id}:{tool_call_id}"
    )


async def start_session(
    services: SessionWriteServices,
    *,
    caller: SessionCaller,
    project_id: UUID,
    user_id: UUID,
    arguments: Any,
) -> PlatformHandlerResult:
    started_at = services.clock()
    try:
        _check_project(caller, project_id)
        parsed = _parse_arguments(arguments)
        _refuse_unknown_arguments(parsed, _START_FIELDS, tool="start_session")
        tool_call_id = _tool_call_id(parsed)
        text = _text_argument(parsed)
        name = parsed.get("name")
        if name is not None and (
            not isinstance(name, str) or len(name) > SESSION_NAME_MAX_CHARS
        ):
            raise _ArgumentsRefused(
                f"`name` must be text of at most {SESSION_NAME_MAX_CHARS} characters.",
                next_step="Send a short `name`, or omit it.",
            )
        wait_ms = _short_wait_ms(parsed)
        minutes = _update_after_minutes(parsed)

        if caller.run_agent_id is None:
            raise _refusal(
                "run_credential_required",
                "This run's credential names no agent, so it cannot start a session.",
                None,
            )
        calling = await calling_turn(
            services=services, caller=caller, project_id=project_id
        )
        await check_session_depth(
            services, project_id=project_id, stream=calling.stream
        )
        entries = (
            []
            if is_builder_agent(caller.run_agent_id)
            else await subagent_entries(
                services=services, project_id=project_id, turn=calling.turn
            )
        )
        target = await may_start(
            services=services,
            caller=caller,
            project_id=project_id,
            arguments=parsed,
            entries=entries,
        )
        revision = await start_revision(
            services=services, project_id=project_id, target=target
        )
        sharing = get_sharing_service()
        policy = await sharing.session_policy(
            project_id=project_id, session_id=caller.run_session_id
        )
        # A private child copies the people named on its calling session, so as many
        # people read it. A session with no stored policy fails closed, as a policy the
        # authority may not run with does.
        grants = (
            await sharing.session_grants(
                project_id=project_id, session_id=caller.run_session_id
            )
            if policy is not None and policy.visibility == Visibility.PRIVATE
            else []
        )
        if policy is None or not _authority_may_run(policy, grants, caller):
            raise _access_denied_private()
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    request_key = start_key(
        calling_session_id=caller.run_session_id,
        calling_execution_id=calling.execution_id,
        tool_call_id=tool_call_id,
    )
    starts = services.starts_service
    try:
        # The count and the start are one step for this calling session, so two
        # concurrent starts cannot both pass the cap. A retry of a start that already
        # ran is not counted again: it answers its first result.
        async with starts.calling_session_lock(
            project_id=project_id, calling_session_id=caller.run_session_id
        ):
            # A retry answers the start that already ran, with its stored revision,
            # even when the agent has a newer revision now.
            started = await starts.fetch_started(
                project_id=project_id, request_key=request_key
            )
            if started is None:
                _check_running_cap(
                    await running_children(
                        services=services, caller=caller, project_id=project_id
                    )
                )
            else:
                # The replay is admitted as the start was: this authority may still
                # run the child session and its agent.
                await starts.admit_replay(
                    envelope=child_envelope(
                        caller=caller, calling_execution_id=calling.execution_id
                    ),
                    session_id=started.session_id,
                    workflow_id=target.workflow.id,
                    boundary=CHILD_RUN_BOUNDARY,
                )
            started = started or await starts.start_once(
                project_id=project_id,
                user_id=user_id,
                workflow_id=target.workflow.id,
                revision_id=revision.id,
                message=text,
                request_key=request_key,
                envelope=child_envelope(
                    caller=caller, calling_execution_id=calling.execution_id
                ),
                access=AccessPolicy(
                    visibility=policy.visibility, owner_user_id=policy.owner_user_id
                ),
                grants=grants,
                calling_session=SessionCallingSession(
                    id=caller.run_session_id,
                    turn_id=calling.first_execution_id,
                    agent_id=caller.run_agent_id,
                    # None for a calling turn that ran an unsaved configuration.
                    revision_id=calling_revision_id(calling.turn),
                ),
                calling_turn_id=calling.first_execution_id,
                boundary=CHILD_RUN_BOUNDARY,
                name=name.strip() if isinstance(name, str) and name.strip() else None,
            )
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)
    except AccessDenied as e:
        return PlatformHandlerResult.failure(_access_denied_from(caller, e))
    except SessionStartNotDurable:
        return PlatformHandlerResult.failure(
            _dispatch_not_confirmed(is_start=True).error
        )

    agent = ChildTurnAgent(
        id=target.workflow.id, slug=target.workflow.slug, name=target.workflow.name
    )
    if started.replayed:
        # A retry names the revision that the first start stored, not the newest one.
        revision = await _stored_revision(
            services, project_id=project_id, started=started, fallback=revision
        )
    child_revision = ChildTurnRevision(id=revision.id, version=revision.version)
    await schedule_still_running(
        services,
        project_id=project_id,
        user_id=user_id,
        caller=caller,
        calling=calling,
        child_session_id=started.session_id,
        child_input_id=started.input_id,
        child_execution_id=started.execution_id,
        child_turn_id=started.execution_id,
        agent=agent,
        revision=child_revision,
        minutes=minutes,
    )
    wait_ms = _remaining_wait_ms(services, started_at=started_at, wait_ms=wait_ms)
    texts = (
        await wait_for_updates(
            services,
            project_id=project_id,
            user_id=user_id,
            calling_session_id=caller.run_session_id,
            children=[started.session_id],
            wait_ms=wait_ms,
            turn_ids={started.session_id: started.execution_id},
        )
        if wait_ms > 0
        else {}
    )
    return PlatformHandlerResult(
        content=texts.get(started.session_id)
        or _running_block(
            session_id=started.session_id,
            agent=agent,
            revision=child_revision,
            turn_id=started.execution_id,
        )
    )


# -- send_session_message -----------------------------------------------------------------


async def _check_send_caps(
    services: SessionWriteServices,
    *,
    caller: SessionCaller,
    project_id: UUID,
    child: SessionStream,
) -> None:
    """A message to a busy child (a running turn or a pending approval) waits in its
    queue, up to the queue cap; a message to an idle child starts a turn, up to the
    running cap. Called under the calling session's lock, so the child's row is read
    again: another send of this session may have started a turn in it a moment ago."""
    child = (
        await services.streams_dao.get_by_session_id(
            project_id=project_id, session_id=child.session_id
        )
        or child
    )
    busy = child.flags.is_running or bool(
        await _pending_interactions(services, project_id, child.session_id)
    )
    if not busy:
        _check_running_cap(
            await running_children(
                services=services,
                caller=caller,
                project_id=project_id,
                exclude=child.session_id,
            )
        )
        return
    cap = env.agenta.sessions.child_queued_messages_limit
    pending = await services.inputs_dao.list_pending(
        project_id=project_id, session_id=child.session_id
    )
    if _queued_from_caller(pending, caller) >= cap:
        raise _refusal(
            CHILD_QUEUE_LIMIT_REACHED,
            f"That child session already holds {cap} queued messages from "
            "this session, the most it may hold.",
            "Wait until the child ends its turn, then send again.",
            retryable=True,
            details={"limit": cap, "session_id": child.session_id},
        )


async def send_session_message(
    services: SessionWriteServices,
    *,
    caller: SessionCaller,
    project_id: UUID,
    user_id: UUID,
    arguments: Any,
) -> PlatformHandlerResult:
    started_at = services.clock()
    try:
        _check_project(caller, project_id)
        parsed = _parse_arguments(arguments)
        _refuse_unknown_arguments(parsed, _SEND_FIELDS, tool="send_session_message")
        tool_call_id = _tool_call_id(parsed)
        session_id = _session_id_value(parsed.get("session_id"))
        text = _text_argument(parsed)
        wait_ms = _short_wait_ms(parsed)
        minutes = _update_after_minutes(parsed)

        child = await child_target(
            services=services,
            caller=caller,
            project_id=project_id,
            session_id=session_id,
            action=Permission.RUN_SESSIONS,
        )
        calling = await calling_turn(
            services=services, caller=caller, project_id=project_id
        )
        agent = await _agent_of(services, project_id, child)
        if not is_builder_agent(caller.run_agent_id):
            entries = await subagent_entries(
                services=services, project_id=project_id, turn=calling.turn
            )
            if _denied(_entry_for(entries, agent.slug if agent else None)):
                raise _agent_not_allowed(
                    (agent.slug if agent else None) or session_id,
                    await _allowed_agents(services, caller, project_id, entries),
                )
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    idempotency_key = send_key(
        calling_session_id=caller.run_session_id,
        calling_execution_id=calling.execution_id,
        tool_call_id=tool_call_id,
    )
    starts = services.starts_service
    try:
        # The count and the send are one step for this calling session, so two
        # concurrent sends cannot both pass a cap. A retry of a send that already
        # wrote its row is not counted again: it answers its first result.
        async with starts.calling_session_lock(
            project_id=project_id, calling_session_id=caller.run_session_id
        ):
            earlier = await services.inputs_dao.fetch_by_idempotency_key(
                project_id=project_id,
                session_id=session_id,
                idempotency_key=idempotency_key,
            )
            if earlier is None:
                await _check_send_caps(
                    services,
                    caller=caller,
                    project_id=project_id,
                    child=child,
                )
            enqueued = await starts.enqueue_session_input(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                kind=PendingInputKind.message,
                content={
                    "session_id": session_id,
                    "references": keyed_references(child.references),
                    "data": {
                        "inputs": {"messages": [{"role": "user", "content": text}]}
                    },
                },
                idempotency_key=idempotency_key,
                run_envelope=child_envelope(
                    caller=caller, calling_execution_id=calling.execution_id
                ),
                dispatch_boundary=CHILD_RUN_BOUNDARY,
                calling_turn_id=calling.first_execution_id,
            )
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)
    except AccessDenied as e:
        return PlatformHandlerResult.failure(_access_denied_from(caller, e))
    except SessionStartNotDurable:
        return PlatformHandlerResult.failure(
            _dispatch_not_confirmed(is_start=False).error
        )

    started_turn = (
        enqueued.execution_id if enqueued.state == PendingInputState.promoted else None
    )
    await schedule_still_running(
        services,
        project_id=project_id,
        user_id=user_id,
        caller=caller,
        calling=calling,
        child_session_id=session_id,
        child_input_id=enqueued.input_id,
        child_execution_id=started_turn,
        child_turn_id=started_turn,
        agent=agent,
        revision=None,
        minutes=minutes,
    )
    if started_turn is None:
        return PlatformHandlerResult(content=_queued_result(session_id))
    wait_ms = _remaining_wait_ms(services, started_at=started_at, wait_ms=wait_ms)
    texts = (
        await wait_for_updates(
            services,
            project_id=project_id,
            user_id=user_id,
            calling_session_id=caller.run_session_id,
            children=[session_id],
            wait_ms=wait_ms,
            turn_ids={session_id: started_turn},
        )
        if wait_ms > 0
        else {}
    )
    return PlatformHandlerResult(
        content=texts.get(session_id)
        or _running_block(
            session_id=session_id, agent=agent, revision=None, turn_id=started_turn
        )
    )


# -- wait_for_sessions --------------------------------------------------------------------


async def wait_for_sessions(
    services: SessionWriteServices,
    *,
    caller: SessionCaller,
    project_id: UUID,
    user_id: UUID,
    arguments: Any,
) -> PlatformHandlerResult:
    try:
        _check_project(caller, project_id)
        parsed = _parse_arguments(arguments)
        _refuse_unknown_arguments(parsed, _WAIT_FIELDS, tool="wait_for_sessions")
        raw_ids = parsed.get("session_ids")
        if not isinstance(raw_ids, list) or not 1 <= len(raw_ids) <= WAIT_SESSIONS_MAX:
            raise _ArgumentsRefused(
                f"`session_ids` must list 1 to {WAIT_SESSIONS_MAX} child sessions.",
                next_step="Send the `session_id` values that `start_session` returned.",
            )
        session_ids = list(
            dict.fromkeys(
                _session_id_value(raw, field="session_ids") for raw in raw_ids
            )
        )
        wait_ms = _int_argument(
            parsed,
            "wait_ms",
            default=WAIT_DEFAULT_MS,
            minimum=WAIT_MIN_MS,
            maximum=WAIT_MAX_MS,
        )
        for session_id in session_ids:
            await child_target(
                services=services,
                caller=caller,
                project_id=project_id,
                session_id=session_id,
                action=Permission.VIEW_SESSIONS,
            )
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    async def settled() -> List[str]:
        idle = []
        for session_id in session_ids:
            stream = await services.streams_dao.get_by_session_id(
                project_id=project_id, session_id=session_id
            )
            if stream is not None and not stream.flags.is_running:
                idle.append(session_id)
        return idle

    texts = await wait_for_updates(
        services,
        project_id=project_id,
        user_id=user_id,
        calling_session_id=caller.run_session_id,
        children=session_ids,
        wait_ms=wait_ms,
        settled=settled,
    )
    blocks = []
    for session_id in session_ids:
        if session_id in texts:
            blocks.append(texts[session_id])
            continue
        blocks.append(
            await _status_block(
                services, caller=caller, project_id=project_id, session_id=session_id
            )
        )
    return PlatformHandlerResult(content="\n\n".join(blocks))


async def _status_block(
    services: SessionWriteServices,
    *,
    caller: SessionCaller,
    project_id: UUID,
    session_id: str,
) -> str:
    """The current block of a child that gave no update in this wait. The access and
    access is read again without the request memo, which still holds the policies
    from before the wait. A child that is gone, or that this authority may no longer
    see, gives no details. A failed read gives no details either, so the updates this
    wait already removed still return."""
    no_details = _running_block(
        session_id=session_id, agent=None, revision=None, turn_id=None
    )
    try:
        with fresh_request_memo():
            if not await caller_may(
                caller, session_id=session_id, action=Permission.VIEW_SESSIONS
            ):
                return no_details
            stream = await services.streams_dao.get_by_session_id(
                project_id=project_id, session_id=session_id
            )
            if stream is None:
                return no_details
            return await current_block(services, project_id=project_id, stream=stream)
    except Exception:  # noqa: BLE001 - the removed updates must still return
        log.warning(
            "[SESSION-TOOLS] child status not read after a wait",
            project_id=str(project_id),
            session_id=session_id,
            exc_info=True,
        )
        return no_details


# -- cancel_session -----------------------------------------------------------------------


async def cancel_session(
    services: SessionWriteServices,
    *,
    caller: SessionCaller,
    project_id: UUID,
    user_id: UUID,
    arguments: Any,
) -> PlatformHandlerResult:
    """Cancel the running turn of a child session through the cancel of the Stop
    control, marked as the calling session's own cancel. The session stays."""
    try:
        _check_project(caller, project_id)
        parsed = _parse_arguments(arguments)
        _refuse_unknown_arguments(parsed, _CANCEL_FIELDS, tool="cancel_session")
        session_id = _session_id_value(parsed.get("session_id"))
        await child_target(
            services=services,
            caller=caller,
            project_id=project_id,
            session_id=session_id,
            action=Permission.RUN_SESSIONS,
        )
    except _Refusal as e:
        return PlatformHandlerResult.failure(e.error)

    try:
        admission = await services.commands_service.request_cancel(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            cancelled_by=CANCELLED_BY_CALLING_SESSION,
        )
        requested = admission.accepted
    except ExecutionExpectationFailed:
        requested = False  # the turn ended while the cancel was admitted
    return PlatformHandlerResult(
        content={"session_id": session_id, "cancel_requested": requested}
    )
