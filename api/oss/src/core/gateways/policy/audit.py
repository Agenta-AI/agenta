"""Gateway call audit events."""

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
    """Build non-sensitive audit attributes for one gateway call."""
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
        attributes["secret_origin"] = outcome.origin.value
    if outcome.usage is not None:
        # The meter's own numbers. Everything upstream of here — the non-streaming drain,
        # the streaming drain, every adapter — fills `outcome.usage`, and this event is its
        # only consumer: until it was read here, a call's token counts were collected and
        # then dropped on the floor (OR49). Counts only; no prompt or completion text can
        # reach an attribute through `GatewayUsage`.
        attributes["calls"] = outcome.usage.calls
        if outcome.usage.input_tokens is not None:
            attributes["input_tokens"] = outcome.usage.input_tokens
        if outcome.usage.output_tokens is not None:
            attributes["output_tokens"] = outcome.usage.output_tokens
        if outcome.usage.cost is not None:
            attributes["cost"] = outcome.usage.cost
    return attributes


async def publish_gateway_call(
    *,
    scope: AuthScope,
    target: GatewayTarget,
    decision: PolicyDecision,
    outcome: GatewayOutcome,
) -> None:
    """Publish one call event without affecting relay behavior."""
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
