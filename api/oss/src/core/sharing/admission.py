"""`RunAdmission`: the check of a run at every point where it starts or resumes.

A run is admitted when its principal may run the session (rule S2, `RUN_SESSIONS`) and
the agent of the current turn (rules A1, A2, `RUN_WORKFLOWS`). The agent is the target
of this turn, from the beat's or the request's references, never the session's stored
`references` (they are filled once and can name an older target).

A refusal raises `AdmissionDenied`. Its `readable` says whether the caller may still
read the session, so a route answers 403 (`access_denied`) or the hiding 404 without a
second check.
"""

from typing import TYPE_CHECKING, List, Optional
from uuid import UUID

from oss.src.core.access.dtos import (
    Action,
    Decision,
    DecisionReason,
    PrincipalKind,
    ResourceKind,
    ResourceRef,
    RunEnvelope,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.sessions.types import SessionReference
from oss.src.core.sharing.types import AdmissionDenied
from oss.src.core.workflows.dtos import AGENT_REFERENCE_KEYS
from oss.src.core.workflows.types import AgentReferenceUnresolved
from oss.src.utils.logging import get_module_logger

if TYPE_CHECKING:  # pragma: no cover - types only, no import cycle at runtime
    from oss.src.core.access.service import AccessService
    from oss.src.core.workflows.service import WorkflowsService
    from agenta.sdk.decorators.running import WorkflowServiceRequest


log = get_module_logger(__name__)

# The `boundary` of each admission point, logged with a refusal.
HEARTBEAT_BOUNDARY = "heartbeat"
QUEUED_DISPATCH_BOUNDARY = "queued_dispatch"
APPROVAL_RESUME_BOUNDARY = "approval_resume"
CHANNEL_TURN_BOUNDARY = "channel_turn"
TRIGGER_DISPATCH_BOUNDARY = "trigger_dispatch"
CHILD_RUN_BOUNDARY = "child_run"
TEMPLATE_START_BOUNDARY = "template_start"


class RunAdmission:
    def __init__(
        self,
        *,
        access_service: "AccessService",
        workflows_service: "WorkflowsService",
    ):
        self._access_service = access_service
        self._workflows_service = workflows_service

    async def admit(
        self,
        *,
        envelope: RunEnvelope,
        session_id: Optional[str],
        agent_artifact_id: Optional[UUID],
        boundary: str,
    ) -> None:
        """Raise `AdmissionDenied` unless the envelope's principal may run the session
        (when given) and the agent (when given). Reads no session row itself: the
        decisions read the cached policies."""

        authority = envelope.authority
        principal = authority.principal

        if session_id is not None:
            session = ResourceRef(kind=ResourceKind.SESSION, id=str(session_id))
            decision = await self._access_service.decide(
                authority=authority,
                principal=principal,
                action=Permission.RUN_SESSIONS,
                resource=session,
            )
            if not decision.allowed:
                view = await self._access_service.decide(
                    authority=authority,
                    principal=principal,
                    action=Permission.VIEW_SESSIONS,
                    resource=session,
                )
                self._refuse(
                    envelope=envelope,
                    decision=decision,
                    action=Permission.RUN_SESSIONS,
                    resource=session,
                    readable=view.allowed,
                    boundary=boundary,
                )

        if agent_artifact_id is not None:
            agent = ResourceRef(kind=ResourceKind.AGENT, id=str(agent_artifact_id))
            decision = await self._access_service.decide(
                authority=authority,
                principal=principal,
                action=Permission.RUN_WORKFLOWS,
                resource=agent,
            )
            if not decision.allowed:
                # A private agent is hidden from everyone but its owner.
                self._refuse(
                    envelope=envelope,
                    decision=decision,
                    action=Permission.RUN_WORKFLOWS,
                    resource=agent,
                    readable=False,
                    boundary=boundary,
                )

    async def session_readable(
        self,
        *,
        envelope: RunEnvelope,
        session_id: str,
    ) -> bool:
        """Whether the envelope's principal may read the session (rule S1). A refusal
        path uses it to answer a hidden session exactly like an unknown one."""

        authority = envelope.authority
        decision = await self._access_service.decide(
            authority=authority,
            principal=authority.principal,
            action=Permission.VIEW_SESSIONS,
            resource=ResourceRef(kind=ResourceKind.SESSION, id=str(session_id)),
        )
        return decision.allowed

    async def admit_turn(
        self,
        *,
        envelope: RunEnvelope,
        session_id: Optional[str],
        project_id: UUID,
        references: Optional[List[SessionReference]],
    ) -> None:
        """The heartbeat's check: the agent the beat's `references` name (one indexed
        read when they name one; `AgentReferenceUnresolved` propagates), then `admit`."""

        agent_artifact_id = await self._workflows_service.resolve_agent_artifact_id(
            project_id=project_id,
            references=references,
        )
        await self.admit(
            envelope=envelope,
            session_id=session_id,
            agent_artifact_id=agent_artifact_id,
            boundary=HEARTBEAT_BOUNDARY,
        )

    async def admit_request(
        self,
        *,
        envelope: RunEnvelope,
        session_id: Optional[str],
        project_id: UUID,
        request: "WorkflowServiceRequest",
        boundary: str,
    ) -> None:
        """The server paths' check: resolve the request's target once (it stays on the
        request, so the invoke runs what was checked), then `admit`. A request without
        references is a draft run: only the session is checked.

        When no target resolves (the request carries an inline `data.revision`, or its
        references resolve to nothing) but the references name an agent, that agent is
        resolved on its own (one indexed read) and checked. An agent reference that
        resolves to nothing is refused like a hidden agent."""

        agent_artifact_id: Optional[UUID] = None
        references = getattr(request, "references", None)
        if references:
            target = await self._workflows_service.resolve_request_target(
                project_id=project_id,
                request=request,
            )
            if target is not None:
                agent_artifact_id = target.artifact_id
            elif AGENT_REFERENCE_KEYS.intersection(references):
                agent_artifact_id = await self._referenced_agent(
                    envelope=envelope,
                    project_id=project_id,
                    references=references,
                    boundary=boundary,
                )
        await self.admit(
            envelope=envelope,
            session_id=session_id,
            agent_artifact_id=agent_artifact_id,
            boundary=boundary,
        )

    async def _referenced_agent(
        self,
        *,
        envelope: RunEnvelope,
        project_id: UUID,
        references: dict,
        boundary: str,
    ) -> Optional[UUID]:
        """The artifact id of the agent a request's `references` map names. Raises
        `AdmissionDenied` (not readable) when it resolves to nothing."""

        elements = [
            SessionReference.model_validate(
                {
                    **(
                        value.model_dump()
                        if hasattr(value, "model_dump")
                        else dict(value or {})
                    ),
                    "key": key,
                }
            )
            for key, value in references.items()
            if key in AGENT_REFERENCE_KEYS
        ]
        try:
            return await self._workflows_service.resolve_agent_artifact_id(
                project_id=project_id,
                references=elements,
            )
        except AgentReferenceUnresolved:
            self._refuse(
                envelope=envelope,
                decision=Decision(allowed=False, reason=DecisionReason.RESOURCE_DENIED),
                action=Permission.RUN_WORKFLOWS,
                resource=ResourceRef(kind=ResourceKind.AGENT, id="unresolved"),
                readable=False,
                boundary=boundary,
            )

    @staticmethod
    def _refuse(
        *,
        envelope: RunEnvelope,
        decision: Decision,
        action: Action,
        resource: ResourceRef,
        readable: bool,
        boundary: str,
    ) -> None:
        authority = envelope.authority
        principal = authority.principal
        acting_user_id = authority.linked_user_id or (
            principal.id if principal.kind == PrincipalKind.HUMAN else None
        )
        log.info(
            "[sharing] admission refused",
            principal_kind=principal.kind.value,
            principal_id=str(principal.id),
            acting_user_id=str(acting_user_id) if acting_user_id else None,
            project_id=str(authority.project_id),
            action=getattr(action, "value", str(action)),
            resource_kind=resource.kind.value,
            resource_id=resource.id,
            reason=decision.reason.value,
            run_id=envelope.context.run_id,
            boundary=boundary,
            origin=envelope.context.origin.value,
        )
        raise AdmissionDenied(decision=decision, readable=readable, boundary=boundary)
