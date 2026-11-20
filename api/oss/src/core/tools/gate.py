"""The server's answer at the approval gate of a session write (design D12, D34).

The runner asks `tools.agenta.resolve_gate` when its own configuration says `ask` for
`start_session`, `send_session_message` or `cancel_session`. The runner sends what it
knows: the call, its execution, and the tool spec's `configured_permission` and
`target_permissions`. The server adds what only it knows: whether that execution is the
one that runs in the calling session now, whether a person sent the turn, and which agent
a named child session runs. The answer is advice to the runner that asked. Every fault
answers `ask`, so the card shows as it does without this op.
"""

import json
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from agenta.sdk.agents.tools.models import (
    CANCEL_SESSION_CALL_REF,
    SEND_SESSION_MESSAGE_CALL_REF,
    SESSION_WRITE_CALL_REFS,
    START_SESSION_CALL_REF,
    Permission,
    target_permission,
)

from oss.src.core.access.permissions.types import Permission as AccessPermission
from oss.src.core.sessions.executions.interfaces import SessionExecutionsDAOInterface
from oss.src.core.sessions.executions.senders import is_sent_by_person
from oss.src.core.sessions.inputs.interfaces import SessionInputsDAOInterface
from oss.src.core.sessions.streams.dtos import SessionStream
from oss.src.core.sessions.streams.interfaces import SessionStreamsDAOInterface
from oss.src.core.sessions.turns.interfaces import SessionTurnsDAOInterface
from oss.src.core.sessions.types import ReferenceKey, SessionReference
from oss.src.core.shared.dtos import Reference
from oss.src.core.tools.platform_handlers import SessionCaller, caller_may
from oss.src.core.workflows.service import WorkflowsService
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# Why the server answered `allow` or `deny`. `approval_choice` (auto-approve, design
# D32) is not built.
CONFIGURED_PERMISSION_BASIS = "configured_permission"


class GateRequest(BaseModel):
    """What the runner sends. Any other shape is a fault and answers `ask`."""

    model_config = ConfigDict(extra="forbid")

    call_ref: str
    # The call's arguments, with the runner's context bindings applied.
    arguments: Dict[str, Any]
    # The runner's own execution.
    execution_id: str = Field(min_length=1)
    # None when the spec carries none: the runner sends `null`, and the answer is `ask`.
    configured_permission: Optional[Permission] = None
    # The Subagent entry permissions, by the entry's slug.
    target_permissions: Dict[str, Permission] = Field(default_factory=dict)


class GateAnswer(BaseModel):
    permission: Literal["allow", "ask", "deny"]
    basis: Optional[str] = None


ASK = GateAnswer(permission="ask")


class GateReader:
    """The facts at the gate that only the server knows, read from the session tables
    and the workflows."""

    def __init__(
        self,
        *,
        streams_dao: SessionStreamsDAOInterface,
        executions_dao: SessionExecutionsDAOInterface,
        inputs_dao: SessionInputsDAOInterface,
        turns_dao: SessionTurnsDAOInterface,
        workflows_service: WorkflowsService,
    ) -> None:
        self._streams = streams_dao
        self._executions = executions_dao
        self._inputs = inputs_dao
        self._turns = turns_dao
        self._workflows = workflows_service

    async def session(
        self, *, project_id: UUID, session_id: str
    ) -> Optional[SessionStream]:
        return await self._streams.get_by_session_id(
            project_id=project_id, session_id=session_id
        )

    async def is_sent_by_person(
        self, *, project_id: UUID, session_id: str, execution_id: str
    ) -> bool:
        return await is_sent_by_person(
            executions_dao=self._executions,
            inputs_dao=self._inputs,
            turns_dao=self._turns,
            project_id=project_id,
            session_id=session_id,
            execution_id=execution_id,
        )

    async def agent_slug(
        self, *, project_id: UUID, reference: Reference
    ) -> Optional[str]:
        """The stored slug of the workflow that `reference` names in the project."""
        workflow = await self._workflows.fetch_workflow(
            project_id=project_id, workflow_ref=reference, include_archived=True
        )
        return workflow.slug if workflow is not None else None


def _agent_reference(raw: Any) -> Optional[Reference]:
    """The `agent` argument, a slug or an id, as a workflow reference."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    raw = raw.strip()
    try:
        return Reference(id=UUID(raw))
    except ValueError:
        pass
    try:
        return Reference(slug=raw)
    except ValidationError:
        return None


def _workflow_reference(
    references: Optional[List[SessionReference]],
) -> Optional[Reference]:
    for reference in references or []:
        if reference.key != ReferenceKey.workflow.value:
            continue
        if reference.id is not None:
            return Reference(id=reference.id)
        if reference.slug:
            return Reference(slug=reference.slug)
    return None


async def target_slug(
    *,
    call_ref: str,
    arguments: Dict[str, Any],
    caller_session_id: str,
    project_id: UUID,
    reader: GateReader,
) -> Optional[str]:
    """The slug of the agent that a session write targets, the key of
    `target_permissions`. The one place that maps a call's target to a slug (design D12).

    `start_session`: the agent that the `agent` argument (a slug or an id) names.
    `send_session_message`: the agent of the session that the `session_id` argument
    names, when that session is a child of the calling session. The stored slug is
    returned, so a different spelling of the argument cannot miss an entry. None when the
    target is not found; the caller then answers `ask`."""

    if call_ref == START_SESSION_CALL_REF:
        reference = _agent_reference(arguments.get("agent"))
        if reference is None:
            return None
        return await reader.agent_slug(project_id=project_id, reference=reference)

    if call_ref == SEND_SESSION_MESSAGE_CALL_REF:
        session_id = arguments.get("session_id")
        if not isinstance(session_id, str) or not session_id:
            return None
        child = await reader.session(project_id=project_id, session_id=session_id)
        if (
            child is None
            or child.calling_session is None
            or child.calling_session.id != caller_session_id
        ):
            return None
        reference = _workflow_reference(child.references)
        if reference is None:
            return None
        return await reader.agent_slug(project_id=project_id, reference=reference)

    return None


def _parse(arguments: Any) -> Optional[GateRequest]:
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError:
            return None
    try:
        return GateRequest.model_validate(arguments)
    except ValidationError:
        return None


async def resolve_gate(
    *,
    caller: SessionCaller,
    project_id: UUID,
    arguments: Any,
    reader: GateReader,
) -> GateAnswer:
    """`allow` only for a session write whose configured permission for this call is
    `allow`, in the execution that runs in the calling session now, in a turn that a
    person sent. `deny` when that permission is `deny`. `ask` in every other case,
    any fault included."""
    try:
        return await _resolve(
            caller=caller, project_id=project_id, arguments=arguments, reader=reader
        )
    except Exception as error:  # noqa: BLE001 - every fault answers `ask`
        log.warning("resolve_gate answered ask after a fault: %s", type(error).__name__)
        return ASK


async def _resolve(
    *,
    caller: SessionCaller,
    project_id: UUID,
    arguments: Any,
    reader: GateReader,
) -> GateAnswer:
    request = _parse(arguments)
    if (
        request is None
        or request.call_ref not in SESSION_WRITE_CALL_REFS
        or request.configured_permission is None
    ):
        return ASK

    # The execution comes from the runner; the server checks that it runs in the
    # calling session (the claim) now, so an older execution gets `ask`.
    calling = await reader.session(project_id=project_id, session_id=caller.session_id)
    if calling is None or calling.turn_id != request.execution_id:
        return ASK

    if request.call_ref == CANCEL_SESSION_CALL_REF:
        permission = request.configured_permission
    else:
        slug = await target_slug(
            call_ref=request.call_ref,
            arguments=request.arguments,
            caller_session_id=caller.session_id,
            project_id=project_id,
            reader=reader,
        )
        if slug is None:
            return ASK
        # A send needs the run authority's own right on the child, now.
        if request.call_ref == SEND_SESSION_MESSAGE_CALL_REF and not await caller_may(
            caller,
            session_id=request.arguments["session_id"],
            action=AccessPermission.RUN_SESSIONS,
        ):
            return ASK
        permission = target_permission(
            request.configured_permission, request.target_permissions.get(slug)
        )

    if permission == "deny":
        return GateAnswer(permission="deny", basis=CONFIGURED_PERMISSION_BASIS)
    if permission == "allow" and await reader.is_sent_by_person(
        project_id=project_id,
        session_id=caller.session_id,
        execution_id=request.execution_id,
    ):
        return GateAnswer(permission="allow", basis=CONFIGURED_PERMISSION_BASIS)
    return ASK
