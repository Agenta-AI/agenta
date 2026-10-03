"""The wallet's answer to the gateway's spend-admission port, and the per-organization
rollout mode every wallet admission point and measurement producer applies."""

import asyncio
from typing import Awaitable, Callable, Optional
from uuid import UUID

from oss.src.core.gateways.policy.dtos import GatewayTarget, SpendAdmission
from oss.src.core.gateways.policy.interfaces import SpendAdmissionInterface
from oss.src.core.rollout.switches import WalletMode, wallet_mode_for
from oss.src.utils.context import AuthScope
from oss.src.utils.logging import get_module_logger

from ee.src.core.wallets.caps import (
    BUILTIN_MODELS_NOT_ENABLED_CODE,
    BUILTIN_MODELS_NOT_ENABLED_MESSAGE,
    WALLET_BALANCE_EXHAUSTED_CODE,
    SessionTurnHoldsInterface,
    model_call_refused_message,
)
from ee.src.core.wallets.interfaces import WalletCheckPort

log = get_module_logger(__name__)

# Below the 2s bound each admission point puts around its whole answer, so a slow wallet in
# shadow mode still admits instead of being refused by that outer bound.
SHADOW_CHECK_TIMEOUT_SECONDS = 1.0

# The session-hold read runs before the balance check, inside the same 2s bound; a slow
# store falls back to the balance check instead of using up the bound.
SESSION_HOLD_TIMEOUT_SECONDS = 0.5


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
    its floor. Nothing is reserved, so an admitted call can settle below it (open-design
    items 2 and 17). A `check` that raises propagates, and the gateway refuses the call.

    Admission is per agent turn where there is one. The runner admits each turn
    (`SandboxUsageService.admit`) and holds it for its session until the turn ends or its
    limit passes. A call whose gateway credential names that session is measured and
    charged but not refused for the balance, so a turn that started finishes (caps.md);
    the turn's limit bounds how far below the floor it goes. Any other call is checked."""

    def __init__(
        self,
        *,
        wallet: WalletCheckPort,
        session_holds: SessionTurnHoldsInterface,
        plan_for: Callable[[UUID], Awaitable[Optional[str]]],
    ):
        self.wallet = wallet
        self.session_holds = session_holds
        self.plan_for = plan_for

    async def admit(
        self,
        *,
        scope: AuthScope,
        target: GatewayTarget,
        session_id: Optional[str] = None,
    ) -> SpendAdmission:
        organization_id = scope.organization_id
        # A `builtin` model call spends the platform's own provider account, and an
        # organization whose wallet is `off` is not measured, so admitting it would serve
        # the call free. Refused instead, without reading the wallet: such an organization
        # keeps its own provider keys through the `standard` and `custom` namespaces.
        if not await measured(organization_id):
            return SpendAdmission(
                allowed=False,
                reason=BUILTIN_MODELS_NOT_ENABLED_CODE,
                message=BUILTIN_MODELS_NOT_ENABLED_MESSAGE,
            )
        if session_id and await self._turn_running(organization_id, session_id):
            return SpendAdmission(allowed=True)
        if await admit_in_mode(
            organization_id=organization_id,
            point="gateway",
            check=lambda: self.wallet.check(organization_id=organization_id),
        ):
            return SpendAdmission(allowed=True)
        return SpendAdmission(
            allowed=False,
            reason=WALLET_BALANCE_EXHAUSTED_CODE,
            message=model_call_refused_message(await self._plan(organization_id)),
        )

    async def _turn_running(self, organization_id: UUID, session_id: str) -> bool:
        # A store that cannot answer falls back to checking the call: the turn may then
        # be refused, never served unchecked.
        try:
            return await asyncio.wait_for(
                self.session_holds.held(
                    organization_id=organization_id, session_id=session_id
                ),
                timeout=SESSION_HOLD_TIMEOUT_SECONDS,
            )
        except Exception:  # noqa: BLE001
            log.warning(
                "[wallets] session holds unavailable; checking the call",
                organization_id=str(organization_id),
                exc_info=True,
            )
            return False

    async def _plan(self, organization_id: UUID) -> Optional[str]:
        try:
            return await self.plan_for(organization_id)
        except Exception:  # noqa: BLE001 - an unknown plan only changes the wording
            log.warning(
                "[wallets] plan unavailable for the refusal message",
                organization_id=str(organization_id),
                exc_info=True,
            )
            return None
