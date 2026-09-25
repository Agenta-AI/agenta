"""Gateway call audit events."""

from typing import Any, Dict, Optional

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

# `method` and `tool` are read off the caller's JSON-RPC body, so their length is the
# caller's choice, and every one of these attributes is published onto a shared event
# stream. A protocol method is a short fixed token and a tool name is an identifier an
# upstream has to be able to route on, so nothing legitimate comes near this bound;
# it exists so a caller cannot turn one relay into an arbitrarily large event.
_MAX_CALLER_SUPPLIED_LENGTH = 200


def _bounded(value: str) -> str:
    return value[:_MAX_CALLER_SUPPLIED_LENGTH]


def build_gateway_call_attributes(
    *,
    scope: AuthScope,
    target: GatewayTarget,
    decision: PolicyDecision,
    outcome: GatewayOutcome,
    run_id: Optional[str] = None,
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
    # The MCP plane's equivalent of `model`: which protocol method was relayed, and —
    # for the methods that name one — which tool. Both are already on `GatewayTarget`
    # and were already filled at the relay seam; until they were read here the event
    # said an MCP endpoint had been called and nothing about what was called on it, so
    # a rejected tool and a listed one were indistinguishable after the fact.
    #
    # The tool's NAME only. A tool's arguments are the caller's data and stay in the
    # request body, which no audit attribute is built from.
    if target.method is not None:
        attributes["method"] = _bounded(target.method)
    if target.tool is not None:
        attributes["tool"] = _bounded(target.tool)
    if decision.reason is not None:
        attributes["reason"] = decision.reason
    if outcome.status_code is not None:
        attributes["status_code"] = outcome.status_code
    if outcome.duration_ms is not None:
        attributes["duration_ms"] = outcome.duration_ms
    if outcome.origin is not None:
        attributes["secret_origin"] = outcome.origin.value
    if run_id is not None:
        # The invocation this call belongs to, minted per workflow run and carried into
        # the sandbox-confined gateway credential the caller presents
        # (`apis/fastapi/gateways/credentials_router.py`). It is the only identifier
        # that ties a relay back to the run that made it; the event carries no other
        # correlation of its own, since `Event.request_id` is generated per event.
        # Absent for a browser or API-key caller, which belongs to no run.
        attributes["run_id"] = _bounded(run_id)
    if outcome.usage is not None:
        # The meter's own numbers. Everything upstream of here — the non-streaming drain,
        # the streaming drain, every adapter — fills `outcome.usage`, and this event is its
        # only consumer: until it was read here, a call's token counts were collected and
        # then dropped on the floor (OR49). Counts only; no prompt or completion text can
        # reach an attribute through `GatewayUsage`.
        attributes["calls"] = outcome.usage.calls
        for field in (
            "input_tokens",
            "cache_read_tokens",
            "cache_write_tokens",
            "output_tokens",
        ):
            value = getattr(outcome.usage, field)
            if value is not None:
                attributes[field] = value
        if outcome.usage.cost is not None:
            attributes["cost"] = outcome.usage.cost
    return attributes


async def publish_gateway_call(
    *,
    scope: AuthScope,
    target: GatewayTarget,
    decision: PolicyDecision,
    outcome: GatewayOutcome,
    run_id: Optional[str] = None,
) -> None:
    """Publish one call event without affecting relay behavior."""
    try:
        attributes = build_gateway_call_attributes(
            scope=scope,
            target=target,
            decision=decision,
            outcome=outcome,
            run_id=run_id,
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
