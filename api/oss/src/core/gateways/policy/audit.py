"""Gateway call audit events (D22, specs-wp4.md).

`build_gateway_call_attributes` / `publish_gateway_call` follow the shape of
`build_trace_fetched_attributes` / `publish_trace_fetched`
(`core/events/utils.py`) — one flat-attribute builder, one publisher, no new
event pipeline. Every gateway relay's `record()` call, allow or deny, on
either plane, lands here.
"""

from typing import Any, Dict

from oss.src.core.events.types import EventType
from oss.src.core.events.utils import _build_event, _safe_publish
from oss.src.core.gateways.policy.dtos import (
    GatewayOutcome,
    GatewayTarget,
    PolicyDecision,
)
from oss.src.utils.context import AuthScope
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


def build_gateway_call_attributes(
    *,
    scope: AuthScope,
    target: GatewayTarget,
    decision: PolicyDecision,
    outcome: GatewayOutcome,
) -> Dict[str, Any]:
    """Flat attribute map for one gateway call — the audit record, never the
    request or response body: no prompt, no completion, no secret value, no
    header (specs-wp4.md)."""
    attributes: Dict[str, Any] = {
        "organization_id": str(scope.organization_id),
        "workspace_id": str(scope.workspace_id),
        "project_id": str(scope.project_id),
        "user_id": str(scope.user_id),
        "plane": target.plane.value,
        "namespace": target.namespace.value,
        "name": target.name,
        "allowed": decision.allowed,
    }
    if target.endpoint_id is not None:
        attributes["endpoint_id"] = str(target.endpoint_id)
    if target.model is not None:
        attributes["model"] = target.model
    if decision.reason is not None:
        attributes["reason"] = decision.reason
    if outcome.status_code is not None:
        attributes["status_code"] = outcome.status_code
    if outcome.origin is not None:
        # The spend-attribution field: unset means the caller's own
        # pass-through secret paid, not ours.
        attributes["secret_origin"] = outcome.origin.value
    return attributes


async def publish_gateway_call(
    *,
    scope: AuthScope,
    target: GatewayTarget,
    decision: PolicyDecision,
    outcome: GatewayOutcome,
) -> None:
    """One event per call. Never raises: `record()` runs on the deny path,
    where an exception would turn a clean 403 into a 500."""
    try:
        attributes = build_gateway_call_attributes(
            scope=scope, target=target, decision=decision, outcome=outcome
        )
        await _safe_publish(
            organization_id=scope.organization_id,
            project_id=scope.project_id,
            event=_build_event(
                event_type=EventType.GATEWAYS_CALLED,
                attributes=attributes,
            ),
        )
    except Exception:  # noqa: BLE001 - audit must never affect the relay's result
        log.warning("[gateways] failed to publish audit event", exc_info=True)
