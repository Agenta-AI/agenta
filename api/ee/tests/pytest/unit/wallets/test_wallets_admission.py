"""The wallet's spend admission: one `check` per call, refusal in the gateway's
vocabulary."""

from uuid import uuid4

import pytest

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.policy.dtos import GatewayPlane, GatewayTarget
from oss.src.utils.context import AuthScope

from ee.src.core.wallets.admission import WalletSpendAdmission


class _Wallet:
    def __init__(self, *, allowed: bool):
        self.allowed = allowed
        self.checked = []

    async def check(self, *, organization_id):
        self.checked.append(organization_id)
        return self.allowed


def _scope() -> AuthScope:
    return AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


_TARGET = GatewayTarget(
    plane=GatewayPlane.LLM, namespace=GatewayEndpointNamespace.BUILTIN, name="mock"
)


@pytest.mark.asyncio
@pytest.mark.parametrize("allowed", [True, False])
async def test_admission_is_one_check_of_the_callers_organization(allowed):
    wallet = _Wallet(allowed=allowed)
    scope = _scope()

    admission = await WalletSpendAdmission(wallet=wallet).admit(
        scope=scope, target=_TARGET
    )

    assert wallet.checked == [scope.organization_id]
    assert admission.allowed is allowed
    assert admission.reason == (None if allowed else "entitlement_denied")
    assert admission.ceiling_musd is None
