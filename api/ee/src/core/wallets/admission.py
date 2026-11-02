"""The wallet's answer to the gateway's spend-admission port."""

import asyncio
from typing import Awaitable, Callable, Optional
from uuid import UUID

from oss.src.core.gateways.types import BUILTIN_MODELS_NOT_ENABLED_MESSAGE
from oss.src.core.gateways.policy.dtos import GatewayTarget, SpendAdmission
from oss.src.core.gateways.policy.interfaces import SpendAdmissionInterface
from oss.src.utils.context import AuthScope
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

from ee.src.core.wallets.caps import (
    BUILTIN_MODELS_NOT_ENABLED_CODE,
    WALLET_BALANCE_EXHAUSTED_CODE,
    SessionTurnHoldsInterface,
    model_call_refused_message,
)
from ee.src.core.wallets.interfaces import WalletCheckPort

log = get_module_logger(__name__)

# The session-hold read runs before the balance check, inside the same 2s bound; a slow
# store falls back to the balance check instead of using up the bound.
SESSION_HOLD_TIMEOUT_SECONDS = 0.5


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
        # A `builtin` model call spends the platform's own provider account, and with the
        # wallet off nothing is measured, so admitting it would serve the call free. Refused
        # instead: the organization keeps its own provider keys through the `standard` and
        # `custom` namespaces.
        if not env.wallets.enabled:
            return SpendAdmission(
                allowed=False,
                reason=BUILTIN_MODELS_NOT_ENABLED_CODE,
                message=BUILTIN_MODELS_NOT_ENABLED_MESSAGE,
            )
        if session_id and await self._turn_running(organization_id, session_id):
            return SpendAdmission(allowed=True)
        if await self.wallet.check(organization_id=organization_id):
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
