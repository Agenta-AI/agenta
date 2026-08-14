"""GatewayPolicyService: authorize, audit, usage (entities.md §8, WP3/WP4).

`authorize()` is the whole of wave 1's decision. There is no entitlement arm (D29):
every user has both gateways, so a check here would ask a question with one answer —
what entitlements will express here are limits, which cannot be enforced before
anything is measured, and ship with metering and billing. `record()` builds and
publishes the audit event via WP4's `policy/audit.py`.
"""

from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.policy.audit import publish_gateway_call
from oss.src.core.gateways.policy.dtos import (
    GatewayOutcome,
    GatewayTarget,
    PolicyDecision,
)
from oss.src.core.gateways.policy.interfaces import SecretsResolverInterface
from oss.src.utils.context import AuthScope
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class GatewayPolicyService:
    def __init__(
        self,
        *,
        resolver: SecretsResolverInterface,
    ) -> None:
        self.resolver = resolver

    # --- authorization (WP3) ------------------------------------------------ #

    async def authorize(
        self,
        *,
        scope: AuthScope,
        permission: Permission,
        target: GatewayTarget,
    ) -> PolicyDecision:
        # Fails closed, and returns rather than raising (entities.md §8): an RBAC
        # dependency blip is a denial the caller can audit, not a 500 that skips
        # record() and loses the event.
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

    # --- audit + usage (WP4, D22, §2.7) ------------------------------------- #

    async def record(
        self,
        *,
        scope: AuthScope,
        target: GatewayTarget,
        decision: PolicyDecision,
        outcome: GatewayOutcome,
    ) -> None:
        # Every relay in WP6/7/8/9 calls this on both the allow and deny
        # branch; publish_gateway_call never raises (D22, specs-wp4.md).
        await publish_gateway_call(
            scope=scope,
            target=target,
            decision=decision,
            outcome=outcome,
        )
