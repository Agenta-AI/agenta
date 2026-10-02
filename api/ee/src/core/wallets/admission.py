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

    # `asyncio.wait`, not `wait_for`: `wait_for` also waits out the check's cancellation
    # cleanup (a DB session closing), which could outlast the caller's bound and refuse.
    check_task = asyncio.ensure_future(check())
    done, _ = await asyncio.wait({check_task}, timeout=SHADOW_CHECK_TIMEOUT_SECONDS)
    if not done:
        check_task.cancel()
        check_task.add_done_callback(_discard_result)
        log.warning(
            "[wallets] shadow: admission check timed out; admitting",
            organization_id=str(organization_id),
            point=point,
        )
        return True
    if check_task.exception() is not None:
        log.warning(
            "[wallets] shadow: admission check failed; admitting",
            organization_id=str(organization_id),
            point=point,
            reason=repr(check_task.exception()),
        )
        return True
    if not check_task.result():
        log.warning(
            "[wallets] shadow: would have refused; admitting",
            organization_id=str(organization_id),
            point=point,
        )
    return True


def _discard_result(task: "asyncio.Future[bool]") -> None:
    # Retrieve the outcome of an abandoned check so asyncio does not log it as unhandled.
    if not task.cancelled():
        task.exception()


async def measured(organization_id: UUID, *, wait: bool = True) -> bool:
    """Whether usage for this organization is measured and charged: `shadow` and
    `enforce` are, `off` is not.

    A producer that records after its own admission passes `wait=False`: it reads the
    payload that admission left, however old, so a long call cannot spend the hand-off
    bound waiting for a refresh and lose its charge.
    """
    mode = await wallet_mode_for(organization_id, wait=wait)
    return mode is not WalletMode.OFF


class WalletSpendAdmission(SpendAdmissionInterface):
    """Admits a platform-funded call while the organization's spendable balance is above
    its floor. One `check` read per call; nothing is reserved, so a call admitted near the
    floor can settle below it (open-design items 2 and 17). A `check` that raises
    propagates, and the gateway refuses the call."""

    def __init__(self, *, wallet: WalletCheckPort):
        self.wallet = wallet

    async def admit(self, *, scope: AuthScope, target: GatewayTarget) -> SpendAdmission:
        # A `builtin` model call spends the platform's own provider account, and an
        # organization whose wallet is `off` is not measured, so admitting it would serve
        # the call free. Refused instead, without reading the wallet: such an organization
        # keeps its own provider keys through the `standard` and `custom` namespaces.
        if not await measured(scope.organization_id):
            return SpendAdmission(allowed=False, reason="wallet_off")
        allowed = await admit_in_mode(
            organization_id=scope.organization_id,
            point="gateway",
            check=lambda: self.wallet.check(organization_id=scope.organization_id),
        )
        if allowed:
            return SpendAdmission(allowed=True)
        return SpendAdmission(allowed=False, reason="entitlement_denied")
