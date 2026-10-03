"""The wallet's spend admission at the gateway: a call whose session runs a turn the
runner admitted is served to the turn's end; any other call is checked."""

from uuid import uuid4

import pytest

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.policy.dtos import GatewayPlane, GatewayTarget
from oss.src.core.rollout.switches import WalletMode
from oss.src.utils.context import AuthScope

from ee.src.core.access.entitlements.types import DefaultPlan
from ee.src.core.wallets import admission as admission_module
from ee.src.core.wallets.admission import WalletSpendAdmission
from ee.src.core.wallets.caps import credit_exhausted_message
from ee.tests.pytest.utils.measurements.fakes import InMemorySessionTurnHolds, no_plan

_HOBBY = DefaultPlan.CLOUD_V0_HOBBY.value


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


async def _hobby(organization_id):
    return _HOBBY


_TARGET = GatewayTarget(
    plane=GatewayPlane.LLM, namespace=GatewayEndpointNamespace.BUILTIN, name="mock"
)


def _admission(wallet, holds=None, plan_for=no_plan):
    return WalletSpendAdmission(
        wallet=wallet,
        session_holds=holds or InMemorySessionTurnHolds(),
        plan_for=plan_for,
    )


@pytest.fixture
def mode(monkeypatch):
    def _set(value: WalletMode) -> None:
        async def _mode(organization_id, **_kwargs):
            return value

        monkeypatch.setattr(admission_module, "wallet_mode_for", _mode)

    return _set


@pytest.mark.asyncio
@pytest.mark.parametrize("allowed", [True, False])
async def test_a_call_with_no_session_is_one_check_of_the_callers_organization(allowed):
    wallet = _Wallet(allowed=allowed)
    scope = _scope()

    admission = await _admission(wallet, plan_for=_hobby).admit(
        scope=scope, target=_TARGET
    )

    assert wallet.checked == [scope.organization_id]
    assert admission.allowed is allowed
    assert admission.reason == (None if allowed else "wallet_balance_exhausted")
    assert admission.message == (None if allowed else credit_exhausted_message(_HOBBY))
    assert admission.ceiling_musd is None


@pytest.mark.asyncio
async def test_a_running_turn_is_not_refused_when_its_balance_reaches_the_floor():
    """Release QA bug 1: the turn's next model call after the floor was refused."""
    wallet = _Wallet(allowed=False)  # the balance reached the floor mid-turn
    holds = InMemorySessionTurnHolds()
    scope = _scope()
    await holds.hold(
        organization_id=scope.organization_id,
        session_id="sess-1",
        turn_id="turn-1",
        ttl_seconds=60,
    )
    gateway = _admission(wallet, holds)

    in_turn = await gateway.admit(scope=scope, target=_TARGET, session_id="sess-1")
    other_session = await gateway.admit(
        scope=scope, target=_TARGET, session_id="sess-2"
    )
    other_org = await gateway.admit(scope=_scope(), target=_TARGET, session_id="sess-1")
    direct = await gateway.admit(scope=scope, target=_TARGET)

    assert in_turn.allowed
    for refused in (other_session, other_org, direct):
        assert not refused.allowed and refused.reason == "wallet_balance_exhausted"
    assert len(wallet.checked) == 3


@pytest.mark.asyncio
async def test_a_hold_store_that_cannot_answer_checks_the_call():
    holds = InMemorySessionTurnHolds()
    holds.fail = True

    refused = await _admission(_Wallet(allowed=False), holds).admit(
        scope=_scope(), target=_TARGET, session_id="sess-1"
    )

    assert refused.reason == "wallet_balance_exhausted"


@pytest.mark.asyncio
async def test_an_off_organization_is_refused_builtin_models_with_its_own_code(mode):
    mode(WalletMode.OFF)
    wallet = _Wallet(allowed=True)
    holds = InMemorySessionTurnHolds()
    scope = _scope()
    await holds.hold(
        organization_id=scope.organization_id,
        session_id="sess-1",
        turn_id="t",
        ttl_seconds=60,
    )

    refused = await _admission(wallet, holds).admit(
        scope=scope, target=_TARGET, session_id="sess-1"
    )

    assert not refused.allowed
    assert refused.reason == "builtin_models_not_enabled"
    assert refused.message.startswith("Built-in models are not enabled")
    assert wallet.checked == []


@pytest.mark.asyncio
async def test_a_shadow_organization_at_its_floor_is_admitted(mode):
    mode(WalletMode.SHADOW)

    admitted = await _admission(_Wallet(allowed=False)).admit(
        scope=_scope(), target=_TARGET, session_id="sess-1"
    )

    assert admitted.allowed
