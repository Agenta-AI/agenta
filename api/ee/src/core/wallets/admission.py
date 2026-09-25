"""The wallet's answer to the gateway's spend-admission port."""

from oss.src.core.gateways.policy.dtos import GatewayTarget, SpendAdmission
from oss.src.core.gateways.policy.interfaces import SpendAdmissionInterface
from oss.src.utils.context import AuthScope

from ee.src.core.wallets.interfaces import WalletCheckPort


class WalletSpendAdmission(SpendAdmissionInterface):
    """Admits a platform-funded call while the organization's spendable balance is above
    its floor. One `check` read per call; nothing is reserved, so a call admitted near the
    floor can settle below it (open-design items 2 and 17). A `check` that raises
    propagates, and the gateway refuses the call."""

    def __init__(self, *, wallet: WalletCheckPort):
        self.wallet = wallet

    async def admit(self, *, scope: AuthScope, target: GatewayTarget) -> SpendAdmission:
        if await self.wallet.check(organization_id=scope.organization_id):
            return SpendAdmission(allowed=True)
        return SpendAdmission(allowed=False, reason="entitlement_denied")
