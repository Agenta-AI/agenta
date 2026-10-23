from typing import Optional

from fastapi import HTTPException, Request

from oss.src.core.access.dtos import RunOrigin
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    AgentReadScope,
    SharedItemKind,
    Visibility,
)
from oss.src.core.sharing.service import get_sharing_service
from oss.src.core.sharing.types import AgentCreationFailed
from oss.src.core.tools.dtos import AgentError
from oss.src.middlewares.auth import request_run_envelope


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


async def agent_read_scope_for_request(request: Request) -> AgentReadScope:
    """The agents a list shows to this request's principal: the principal's own
    private agents (a human only), and every project-visible agent. A request without
    a principal sees no private agent."""

    principal = getattr(request.state, "principal", None)
    if principal is None:
        return AgentReadScope(owner_user_id=None)
    return await get_sharing_service().agent_read_scope(principal=principal)


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
