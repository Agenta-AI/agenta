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
    PrincipalKind,
    ResourceKind,
    ResourceRef,
    RunEnvelope,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.sessions.types import SessionReference
from oss.src.core.sharing.types import AdmissionDenied
from oss.src.utils.logging import get_module_logger

if TYPE_CHECKING:  # pragma: no cover - types only, no import cycle at runtime
    from oss.src.core.access.service import AccessService
    from oss.src.core.workflows.service import WorkflowsService
    from agenta.sdk.decorators.running import WorkflowServiceRequest


log = get_module_logger(__name__)

HEARTBEAT_BOUNDARY = "heartbeat"


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
        references is a draft run: only the session is checked."""

        agent_artifact_id: Optional[UUID] = None
        if getattr(request, "references", None):
            target = await self._workflows_service.resolve_request_target(
                project_id=project_id,
                request=request,
            )
            agent_artifact_id = target.artifact_id if target is not None else None
        await self.admit(
            envelope=envelope,
            session_id=session_id,
            agent_artifact_id=agent_artifact_id,
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
