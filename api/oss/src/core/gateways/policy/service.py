"""Authorize gateway access and publish audit events."""

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

    # Audit and usage

    async def record(
        self,
        *,
        scope: AuthScope,
        target: GatewayTarget,
        decision: PolicyDecision,
        outcome: GatewayOutcome,
    ) -> None:
        # Publish audit events for both allowed and denied relays.
        await publish_gateway_call(
            scope=scope,
            target=target,
            decision=decision,
            outcome=outcome,
        )
