from enum import Enum
from functools import wraps
from typing import Any, Optional, Union
from uuid import UUID

from fastapi import HTTPException, Request

from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION
from oss.src.core.access.context import get_request_access
from oss.src.core.access.dtos import (
    Decision,
    DecisionReason,
    RequestAccess,
    ResourceKind,
    ResourceRef,
    RunOrigin,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.principals import access_denied_error
from oss.src.core.access.service import get_access_service
from oss.src.core.access.types import AccessDenied, RequestAccessMissing
from oss.src.core.mounts.dtos import MountScope
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    AgentReadScope,
    SessionReadScope,
    SharedItemKind,
    Visibility,
)
from oss.src.core.sharing.service import get_sharing_service
from oss.src.core.sharing.types import (
    AgentCreationFailed,
    InvalidGrantee,
    InvalidTransferTarget,
    OwnerStillActive,
    SessionNotShareable,
    SharedItemNotFound,
    SharingConflict,
    SharingError,
)
from oss.src.core.tools.dtos import AgentError
from oss.src.dbs.redis.sessions.locks import get_turn_admission
from oss.src.dbs.redis.shared.engine import get_lock_engine
from oss.src.middlewares.auth import request_run_envelope


# The one answer of every hiding refusal on the new sharing routes and the heartbeat:
# a private session or agent, and an unknown, archived or foreign-project reference.
# Existing routes answer what they answer for an unknown id instead.
NOT_FOUND_ERROR = AgentError(code="not_found", message="Not found.", retryable=False)


def not_found_exception() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=NOT_FOUND_ERROR.model_dump(exclude_none=True),
    )


class ResourceCheck(str, Enum):
    """The outcome of one resource check at a route.

    ALLOWED: go on. HIDDEN: the caller may not read the item; answer what the route
    answers for an unknown id. FORBIDDEN: the caller may read the item but not do the
    action; answer 403 `access_denied` (`resource_denied`). NO_CAPABILITY: the caller's
    role does not allow the action at all; answer today's `FORBIDDEN_EXCEPTION`."""

    ALLOWED = "allowed"
    HIDDEN = "hidden"
    FORBIDDEN = "forbidden"
    NO_CAPABILITY = "no_capability"


# The read action of each resource kind: a caller that fails it cannot know the item.
_VIEW_ACTIONS = {
    ResourceKind.SESSION: Permission.VIEW_SESSIONS,
    ResourceKind.AGENT: Permission.VIEW_WORKFLOWS,
}


def session_resource(session_id: str) -> ResourceRef:
    return ResourceRef(kind=ResourceKind.SESSION, id=str(session_id))


def agent_resource(artifact_id: Union[UUID, str]) -> ResourceRef:
    return ResourceRef(kind=ResourceKind.AGENT, id=str(artifact_id))


async def check_resource_for(
    *,
    access: RequestAccess,
    action: Permission,
    project_id: UUID,
    resource: ResourceRef,
) -> ResourceCheck:
    """`check_resource` for a request access captured earlier (the live stream
    recheck runs outside the request's context)."""

    access_service = get_access_service()
    decision = await access_service.check_request(
        access=access,
        action=action,
        project_id=project_id,
        resource=resource,
    )
    if decision.allowed:
        return ResourceCheck.ALLOWED
    if decision.reason != DecisionReason.RESOURCE_DENIED:
        return ResourceCheck.NO_CAPABILITY

    view_action = _VIEW_ACTIONS[resource.kind]
    if action == view_action:
        return ResourceCheck.HIDDEN
    view = await access_service.check_request(
        access=access,
        action=view_action,
        project_id=project_id,
        resource=resource,
    )
    return ResourceCheck.FORBIDDEN if view.allowed else ResourceCheck.HIDDEN


async def check_resource(
    request: Request,
    *,
    action: Permission,
    resource: ResourceRef,
) -> ResourceCheck:
    """One decision for the request's principal on one agent or session. The project
    is always the request's: a browser session (Bearer) has no authority, so the
    decision cannot take the project from it. A missing row is ALLOWED (the route's
    own not-found path answers)."""

    access = get_request_access()
    if access is None:
        raise RequestAccessMissing()
    return await check_resource_for(
        access=access,
        action=action,
        project_id=UUID(str(request.state.project_id)),
        resource=resource,
    )


def resource_denied_exception(request: Request) -> HTTPException:
    """403 `access_denied` with `details.reason = "resource_denied"`: the caller may
    read the item but not do this action on it."""

    access = get_request_access()
    return HTTPException(
        status_code=403,
        detail=access_denied_error(
            decision=Decision(allowed=False, reason=DecisionReason.RESOURCE_DENIED),
            principal_kind=access.principal.kind,
            project_id=UUID(str(request.state.project_id)),
        ).model_dump(exclude_none=True),
    )


async def allow_resource(
    request: Request,
    *,
    action: Permission,
    resource: ResourceRef,
) -> bool:
    """True when the request may do `action` on the resource. False when the item is
    hidden from the caller: the route then answers exactly what it answers for an
    unknown id. Raises 403 `access_denied` (FORBIDDEN) or today's
    `FORBIDDEN_EXCEPTION` (NO_CAPABILITY)."""

    check = await check_resource(request, action=action, resource=resource)
    if check == ResourceCheck.ALLOWED:
        return True
    if check == ResourceCheck.HIDDEN:
        return False
    if check == ResourceCheck.FORBIDDEN:
        raise resource_denied_exception(request)
    raise FORBIDDEN_EXCEPTION


async def allow_session_write(
    request: Request,
    *,
    session_id: str,
    turn_id: Optional[str],
) -> bool:
    """`allow_resource(RUN_SESSIONS)` on a session for a runner write route (records,
    interactions, turns: rule S2), with the heartbeat's verified continuity as the
    free path. When the body names a turn and that turn's heartbeat admitted this
    request's principal on this session (the admission record, one Redis read that
    renews it), the write is allowed with no decision: it is the run the heartbeat
    authorized. Any other write (no turn, no record, a record of another principal,
    session or turn, a Redis error) runs the full check."""

    if turn_id:
        envelope = request_run_envelope(request)
        if envelope is not None:
            admitted = await get_turn_admission(
                get_lock_engine(),
                project_id=str(request.state.project_id),
                session_id=session_id,
                turn_id=str(turn_id),
            )
            if admitted is not None and admitted == envelope.authority.principal:
                return True
    return await allow_resource(
        request,
        action=Permission.RUN_SESSIONS,
        resource=session_resource(session_id),
    )


def artifact_id_of(entity: Any) -> Optional[UUID]:
    """The agent (artifact) id a workflow, application or evaluator variant or
    revision belongs to; the id itself for an artifact."""
    for name in ("workflow_id", "application_id", "evaluator_id", "artifact_id"):
        value = getattr(entity, name, None)
        if value is not None:
            return value
    return None


async def allow_agent(
    request: Request,
    *,
    action: Permission,
    artifact_id: Optional[Union[UUID, str]],
) -> bool:
    """`allow_resource` on an agent (rules A1, A2). The rules do not depend on the
    action, so a route passes its own permission and its capability check is
    unchanged; an agent is either visible or hidden, never FORBIDDEN. No artifact id
    names no agent."""
    if artifact_id is None:
        return True
    return await allow_resource(
        request, action=action, resource=agent_resource(artifact_id)
    )


async def visible_by_agent(
    request: Request, items: list, *, action: Permission
) -> list:
    """The items (variants or revisions) whose agent the caller may read, one
    cached check per agent."""
    visible: dict = {}
    kept = []
    for item in items:
        artifact_id = artifact_id_of(item)
        if artifact_id not in visible:
            visible[artifact_id] = await allow_agent(
                request, action=action, artifact_id=artifact_id
            )
        if visible[artifact_id]:
            kept.append(item)
    return kept


async def allow_mount(
    request: Request,
    *,
    scope: Optional[MountScope],
    permission: Permission,
) -> bool:
    """`allow_resource` for a mount, with the route's mounts `permission`. A session
    mount follows its session: reading (`VIEW_MOUNTS`) is rule S1, writing and signing
    are rule S2 (`RUN_SESSIONS`). An agent mount follows its agent (rules A1, A2, which
    do not depend on the action, so the route's own permission is the action). A
    project mount, and an unknown mount (`scope` None: the route's own not-found path
    answers), are allowed."""

    if scope is None:
        return True
    if scope.session_id:
        return await allow_resource(
            request,
            action=(
                Permission.VIEW_MOUNTS
                if permission == Permission.VIEW_MOUNTS
                else Permission.RUN_SESSIONS
            ),
            resource=session_resource(scope.session_id),
        )
    if scope.agent_id:
        return await allow_resource(
            request,
            action=permission,
            resource=agent_resource(scope.agent_id),
        )
    return True


def policy_for_request(
    request: Request,
    *,
    kind: SharedItemKind,
    requested: Optional[Visibility] = None,
) -> AccessPolicy:
    """The initial policy of an item this request creates, from the request's run
    envelope (CONTRACT section 7). A request without an envelope gets the ownerless
    project policy, the least access an item can have from its owner rule. A session
    an installation run creates is a channel session."""

    envelope = request_run_envelope(request)
    if envelope is None:
        return OWNERLESS_PROJECT_POLICY

    origin = envelope.context.origin
    if origin == RunOrigin.INSTALLATION and kind == SharedItemKind.SESSION:
        kind = SharedItemKind.CHANNEL_SESSION

    return get_sharing_service().initial_policy(
        principal=envelope.authority.principal,
        origin=origin,
        sender_user_id=envelope.sender.user_id if envelope.sender else None,
        kind=kind,
        requested=requested,
    )


def agent_owner_for_request(request: Request) -> Optional[UUID]:
    """The owner a commit through this request gives an artifact whose first agent
    revision it writes (CONTRACT section 7): the ownership rule applied to the
    request's run envelope. None for an API key, an installation, a child run or a
    request without an envelope."""

    return policy_for_request(request, kind=SharedItemKind.AGENT).owner_user_id


async def agent_read_scope_for_request(request: Request) -> AgentReadScope:
    """The agents a list shows to this request's principal: the principal's own
    private agents (a human only), and every project-visible agent. A request without
    a principal sees no private agent."""

    principal = getattr(request.state, "principal", None)
    if principal is None:
        return AgentReadScope(owner_user_id=None)
    return await get_sharing_service().agent_read_scope(principal=principal)


async def session_read_scope_for_request(request: Request) -> SessionReadScope:
    """The sessions a list shows to this request's principal: every project-visible
    session, and for a human their own private sessions and the sessions granted to
    them. A request without a principal sees no private session."""

    principal = getattr(request.state, "principal", None)
    if principal is None:
        return SessionReadScope(
            owner_user_id=None, include_project=True, granted_stream_ids=[]
        )
    return await get_sharing_service().session_read_scope(
        project_id=UUID(str(request.state.project_id)),
        principal=principal,
    )


def agent_creation_failed_exception(error: AgentCreationFailed) -> HTTPException:
    """500 `agent_creation_failed`: the artifact and its access row rolled back, so
    sending the same request again is safe."""

    return HTTPException(
        status_code=500,
        detail=AgentError(
            code=error.code,
            message=error.message,
            retryable=True,
            next_step="Send the same request again.",
        ).model_dump(exclude_none=True),
    )


# The HTTP answer of each sharing error (interfaces section 5): status, retryable and
# next_step. `SharedItemNotFound` answers the canonical `NOT_FOUND_ERROR`.
_SHARING_ERRORS = (
    (SharingConflict, 409, True, "Reload the sharing state and retry."),
    (InvalidGrantee, 422, False, None),
    (SessionNotShareable, 409, False, None),
    (OwnerStillActive, 409, False, None),
    (InvalidTransferTarget, 422, False, None),
    (AgentCreationFailed, 500, True, "Send the same request again."),
)


def sharing_error_exception(error: SharingError) -> HTTPException:
    if isinstance(error, SharedItemNotFound):
        return not_found_exception()
    status_code, retryable, next_step = 400, False, None
    for error_type, status, error_retryable, error_next_step in _SHARING_ERRORS:
        if isinstance(error, error_type):
            status_code, retryable, next_step = status, error_retryable, error_next_step
            break
    return HTTPException(
        status_code=status_code,
        detail=AgentError(
            code=error.code,
            message=error.message,
            retryable=retryable,
            next_step=next_step,
            details=error.details or None,
        ).model_dump(exclude_none=True),
    )


def _access_denied_exception(error: AccessDenied, request: Any) -> HTTPException:
    """403 `access_denied` for a refused write on an item the caller may read
    (`resource_denied`), with M2's error body."""

    access = get_request_access()
    if access is None or request is None:
        return FORBIDDEN_EXCEPTION
    return HTTPException(
        status_code=403,
        detail=access_denied_error(
            decision=error.decision,
            principal_kind=access.principal.kind,
            project_id=UUID(str(request.state.project_id)),
        ).model_dump(exclude_none=True),
    )


def handle_sharing_exceptions():
    """Map every `SharingError` and `AccessDenied` by name to its HTTP answer, before
    `@intercept_exceptions()` would turn it into a 500."""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except SharingError as error:
                raise sharing_error_exception(error) from error
            except AccessDenied as error:
                raise _access_denied_exception(error, kwargs.get("request")) from error

        return wrapper

    return decorator
