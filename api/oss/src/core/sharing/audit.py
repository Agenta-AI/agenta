"""Sharing audit events: one event per agent or session sharing change.

Follows `core/gateways/policy/audit.py`: the change has committed before the publish,
and a failed publish logs a warning and never fails the write. Attributes carry ids and
kinds only, never credential values, tokens or envelopes. Denials are logs, not events.
"""

from typing import Any, Dict, List, Optional, Sequence
from uuid import UUID

from oss.src.core.access.dtos import RequestAccess, ResourceKind, ResourceRef
from oss.src.core.events.types import EventType
from oss.src.core.events.utils import _build_event, _safe_publish
from oss.src.core.sharing.dtos import AccessPolicy, SessionGrantInput
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


_EVENT_TYPES = {
    ResourceKind.AGENT: EventType.AGENTS_SHARING_CHANGED,
    ResourceKind.SESSION: EventType.SESSIONS_SHARING_CHANGED,
}


def _policy(policy: Optional[AccessPolicy]) -> Optional[Dict[str, Any]]:
    if policy is None:
        return None
    return {
        "visibility": policy.visibility.value,
        "owner_user_id": (
            str(policy.owner_user_id) if policy.owner_user_id is not None else None
        ),
    }


def build_sharing_attributes(
    *,
    access: RequestAccess,
    resource: ResourceRef,
    before: Optional[AccessPolicy],
    after: AccessPolicy,
    grants_added: Sequence[SessionGrantInput] = (),
    grants_removed: Sequence[UUID] = (),
) -> Dict[str, Any]:
    attributes: Dict[str, Any] = {
        "resource": {"kind": resource.kind.value, "id": resource.id},
        "before": _policy(before),
        "after": _policy(after),
        "grants_added": [
            {"user_id": str(grant.user_id), "role": grant.role.value}
            for grant in grants_added
        ],
        "grants_removed": [str(user_id) for user_id in grants_removed],
        "principal": {
            "kind": access.principal.kind.value,
            "id": str(access.principal.id),
        },
        "credential": access.credential_kind.value,
        "acting_user_id": str(access.acting_user_id),
    }
    # The run a run credential belongs to; the event's own request id is minted per
    # event, so it ties nothing together.
    run_id = access.envelope.context.run_id if access.envelope is not None else None
    if run_id is not None:
        attributes["run_id"] = run_id
    return attributes


async def publish_sharing_event(
    *,
    organization_id: UUID,
    project_id: UUID,
    access: RequestAccess,
    #
    resource: ResourceRef,
    before: Optional[AccessPolicy],
    after: AccessPolicy,
    grants_added: List[SessionGrantInput] = [],  # noqa: B006 (never mutated)
    grants_removed: List[UUID] = [],  # noqa: B006 (never mutated)
) -> None:
    """Publish one sharing change. Never raises."""

    try:
        await _safe_publish(
            organization_id=organization_id,
            project_id=project_id,
            event=_build_event(
                event_type=_EVENT_TYPES[resource.kind],
                attributes=build_sharing_attributes(
                    access=access,
                    resource=resource,
                    before=before,
                    after=after,
                    grants_added=grants_added,
                    grants_removed=grants_removed,
                ),
            ),
        )
    except Exception:  # noqa: BLE001 - audit must never fail the sharing write
        log.warning("[sharing] failed to publish audit event", exc_info=True)
