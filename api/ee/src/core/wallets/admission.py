"""The wallet's answer to the gateway's spend-admission port, and the per-organization
rollout mode every wallet admission point and measurement producer applies."""

import asyncio
from typing import Awaitable, Callable
from uuid import UUID

from oss.src.core.gateways.policy.dtos import GatewayTarget, SpendAdmission
from oss.src.core.gateways.policy.interfaces import SpendAdmissionInterface
from oss.src.core.rollout.switches import WalletMode, wallet_mode_for
from oss.src.utils.context import AuthScope
from oss.src.utils.logging import get_module_logger

from ee.src.core.wallets.interfaces import WalletCheckPort

log = get_module_logger(__name__)

# Below the 2s bound each admission point puts around its whole answer, so a slow wallet in
# shadow mode still admits instead of being refused by that outer bound.
SHADOW_CHECK_TIMEOUT_SECONDS = 1.0


async def admit_in_mode(
    *,
    organization_id: UUID,
    point: str,
    check: Callable[[], Awaitable[bool]],
) -> bool:
    """Apply the organization's `wallets-rollout` mode to one admission.

    `off` admits without reading the wallet. `shadow` reads it and admits whatever it says,
    logging what `enforce` would have refused. `enforce` returns the wallet's answer, and a
    check that raises propagates, so the caller fails closed as before.
    """
    mode = await wallet_mode_for(organization_id)
    if mode is WalletMode.OFF:
        return True
    if mode is WalletMode.ENFORCE:
        return await check()

    try:
        allowed = await asyncio.wait_for(check(), timeout=SHADOW_CHECK_TIMEOUT_SECONDS)
    except Exception as exc:  # noqa: BLE001 - shadow never refuses
        log.warning(
            "[wallets] shadow: admission check failed; admitting",
            organization_id=str(organization_id),
            point=point,
            reason=repr(exc),
        )
        return True
    if not allowed:
        log.warning(
            "[wallets] shadow: would have refused; admitting",
            organization_id=str(organization_id),
            point=point,
        )
    return True


async def measured(organization_id: UUID) -> bool:
    """Whether usage for this organization is measured and charged: `shadow` and
    `enforce` are, `off` is not."""
    return await wallet_mode_for(organization_id) is not WalletMode.OFF


class WalletSpendAdmission(SpendAdmissionInterface):
    """Admits a platform-funded call while the organization's spendable balance is above
    its floor. One `check` read per call; nothing is reserved, so a call admitted near the
    floor can settle below it (open-design items 2 and 17). A `check` that raises
    propagates, and the gateway refuses the call."""

    def __init__(self, *, wallet: WalletCheckPort):
        self.wallet = wallet

    async def admit(self, *, scope: AuthScope, target: GatewayTarget) -> SpendAdmission:
        allowed = await admit_in_mode(
            organization_id=scope.organization_id,
            point="gateway",
            check=lambda: self.wallet.check(organization_id=scope.organization_id),
        )
        if allowed:
            return SpendAdmission(allowed=True)
        return SpendAdmission(allowed=False, reason="entitlement_denied")
