"""Authorize gateway access, admit platform-funded spend, and record each call."""

import asyncio
from typing import Optional

from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.policy.audit import publish_gateway_call
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.policy.dtos import (
    GatewayOutcome,
    GatewayPlane,
    GatewayTarget,
    PolicyDecision,
    SpendAdmission,
)
from oss.src.core.gateways.policy.interfaces import (
    SecretsResolverInterface,
    SpendAdmissionInterface,
    UsageSinkInterface,
)
from oss.src.core.gateways.policy.null import NullSpendAdmission, NullUsageSink
from oss.src.utils.context import AuthScope
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# The longest a usage hand-off may hold a relay. A non-streaming response is returned only
# after its call is recorded, so a stalled sink (an unresponsive Redis) would otherwise stall
# a call that already succeeded. A hand-off that runs out is a lost measurement, the same
# accepted, logged loss as a failed publish.
USAGE_SINK_TIMEOUT_SECONDS = 0.5


class GatewayPolicyService:
    def __init__(
        self,
        *,
        resolver: SecretsResolverInterface,
        spend_admission: Optional[SpendAdmissionInterface] = None,
        usage_sink: Optional[UsageSinkInterface] = None,
    ) -> None:
        self.resolver = resolver
        self.spend_admission = spend_admission or NullSpendAdmission()
        self.usage_sink = usage_sink or NullUsageSink()

    # Authorization

    async def authorize(
        self,
        *,
        scope: AuthScope,
        permission: Permission,
        target: GatewayTarget,
    ) -> PolicyDecision:
        # Authorization failures are recorded as denials.
        try:
            allowed = await check_action_access(
                user_uid=str(scope.user_id),
                project_id=str(scope.project_id),
                permission=permission,
            )
        except Exception:  # noqa: BLE001 - any failure denies; never opens
            log.error(
                "[gateways] authorization check failed; denying",
                permission=permission.value,
                project_id=str(scope.project_id),
                exc_info=True,
            )
            return PolicyDecision(
                allowed=False,
                permission=permission,
                reason="permission_check_failed",
            )
        if not allowed:
            return PolicyDecision(
                allowed=False,
                permission=permission,
                reason="permission_denied",
            )

        return PolicyDecision(allowed=True, permission=permission, reason=None)

    # Spend admission

    async def admit(
        self,
        *,
        scope: AuthScope,
        target: GatewayTarget,
    ) -> SpendAdmission:
        # Fails closed: a wallet that cannot answer has not said the organization may
        # spend, and a platform-funded call spends money we would then not have checked.
        try:
            return await self.spend_admission.admit(scope=scope, target=target)
        except Exception:  # noqa: BLE001 - any failure refuses; never opens
            log.error(
                "[gateways] spend admission failed; refusing",
                organization_id=str(scope.organization_id),
                exc_info=True,
            )
            return SpendAdmission(allowed=False, reason="entitlement_denied")

    # Audit and usage

    async def record(
        self,
        *,
        scope: AuthScope,
        target: GatewayTarget,
        decision: PolicyDecision,
        outcome: GatewayOutcome,
        run_id: Optional[str] = None,
    ) -> None:
        # Only a dispatched, platform-funded LLM call is a usage fact worth billing: a
        # refusal reached no provider, `standard` and `custom` spend the customer's own
        # credential, and MCP has no charging path yet. Their usage stays in the audit
        # event below.
        #
        # The hand-off goes first so that billing never waits behind the audit publish,
        # which has no bound of its own.
        if (
            decision.allowed
            and target.plane == GatewayPlane.LLM
            and target.namespace == GatewayEndpointNamespace.BUILTIN
            and outcome.usage is not None
        ):
            await self._hand_off_usage(
                scope=scope, target=target, outcome=outcome, run_id=run_id
            )

        # Publish audit events for both allowed and denied relays.
        #
        # `run_id` is call context rather than target, verdict or outcome, so it travels
        # beside them instead of being folded into one of the three. It is optional
        # because only a caller that arrived on a run-bound gateway credential has one:
        # a browser or an API key belongs to no run.
        await publish_gateway_call(
            scope=scope,
            target=target,
            decision=decision,
            outcome=outcome,
            run_id=run_id,
        )

    async def _hand_off_usage(
        self,
        *,
        scope: AuthScope,
        target: GatewayTarget,
        outcome: GatewayOutcome,
        run_id: Optional[str],
    ) -> None:
        try:
            await asyncio.wait_for(
                self.usage_sink.record(
                    scope=scope, target=target, outcome=outcome, run_id=run_id
                ),
                timeout=USAGE_SINK_TIMEOUT_SECONDS,
            )
        except Exception:  # noqa: BLE001 - usage must never affect the relay's result
            log.error(
                "[gateways] usage hand-off failed; the call is not measured",
                organization_id=str(scope.organization_id),
                model=target.model,
                exc_info=True,
            )
