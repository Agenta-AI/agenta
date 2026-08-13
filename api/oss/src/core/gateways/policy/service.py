"""GatewayPolicyService: authorize, audit, usage (entities.md §8, WP3/WP4).

`authorize()` is the whole of wave 1's decision. There is no entitlement arm (D29):
every user has both gateways, so a check here would ask a question with one answer —
what entitlements will express here are limits, which cannot be enforced before
anything is measured, and ship with metering and billing. `record()` is a wave-1 stub;
its real body — building the audit event and publishing it — is WP4's
`policy/audit.py`, landing in wave 2.
"""

from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.policy.dtos import (
    GatewayOutcome,
    GatewayTarget,
    PolicyDecision,
)
from oss.src.core.gateways.policy.interfaces import CredentialResolverInterface
from oss.src.utils.context import AuthScope
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class GatewayPolicyService:
    def __init__(
        self,
        *,
        resolver: CredentialResolverInterface,
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
        # Fail-closed by construction: no try/except here, so an exception from
        # check_action_access propagates rather than being swallowed into
        # allowed=True (entities.md §8: "raises nothing" describes this
        # method's own return contract, not a mandate to catch its dependency).
        allowed = await check_action_access(
            user_uid=str(scope.user_id),
            project_id=str(scope.project_id),
            permission=permission,
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
        # Wave-1 stub (R4): every relay in WP6/7/8/9 calls this on both the
        # allow and deny branch, so it must exist and never raise. The real
        # body — build_gateway_call_attributes + publish_gateway_call — is
        # WP4's policy/audit.py, not built here.
        log.debug("gateway policy record stub invoked, no-op in wave 1")
        return
