from typing import Optional

from fastapi import Request

from oss.src.core.access.dtos import RunOrigin
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    SharedItemKind,
    Visibility,
)
from oss.src.core.sharing.service import get_sharing_service
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
