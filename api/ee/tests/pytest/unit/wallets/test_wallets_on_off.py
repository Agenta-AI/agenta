"""`AGENTA_WALLETS_ENABLED` at every admission point and every measurement producer.

Off admits without reading the wallet and measures nothing. On is the wallet's answer.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.policy.dtos import (
    GatewayOutcome,
    GatewayPlane,
    GatewayTarget,
    GatewayUsage,
    SecretOrigin,
)
from oss.src.core.managed_tools.dtos import (
    ManagedActionContext,
    ManagedActionMeasurement,
    ManagedActionOutcome,
)
from oss.src.core.managed_tools.mock.actions import ENRICH_PERSON
from oss.src.utils.context import AuthScope

from ee.src.core.access.entitlements.types import DefaultPlan

from ee.src.core.measurements.sandboxes import (
    SandboxUsageInterval,
    SandboxUsageService,
)
from ee.src.core.measurements.sink import MeasurementUsageSink
from ee.src.core.measurements.tools import WalletManagedActionBilling
from ee.src.core.wallets.admission import WalletSpendAdmission
from ee.tests.pytest.utils.wallets.switch import set_wallets_enabled
from ee.tests.pytest.utils.measurements.fakes import (
    InMemoryMeasurementPublisher,
    InMemorySessionTurnHolds,
    InMemoryTurnSlots,
    no_plan,
)

START = datetime(2026, 10, 1, 12, 0, 0, tzinfo=timezone.utc)

_TARGET = GatewayTarget(
    plane=GatewayPlane.LLM,
    namespace=GatewayEndpointNamespace.BUILTIN,
    name="mock",
    provider="mock",
    model="gpt-5.5",
)


class _Wallet:
    """Answers both reads the admission points make; counts them."""

    def __init__(self, *, allowed: bool = False, raises: bool = False):
        self.allowed = allowed
        self.raises = raises
        self.reads = 0

    async def check(self, *, organization_id):
        return await self._read()

    async def covers(self, *, organization_id, amount_musd):
        return await self._read()

    async def _read(self):
        self.reads += 1
        if self.raises:
            raise RuntimeError("wallet unreachable")
        return self.allowed


def _scope() -> AuthScope:
    return AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


@pytest.fixture
def wallet_on(monkeypatch):
    """Set `AGENTA_WALLETS_ENABLED`, overriding the suite's on."""

    def _set(value: bool) -> None:
        set_wallets_enabled(monkeypatch, value)

    return _set


async def _gateway(wallet, scope):
    result = await WalletSpendAdmission(
        wallet=wallet, session_holds=InMemorySessionTurnHolds(), plan_for=no_plan
    ).admit(scope=scope, target=_TARGET)
    return result.allowed


async def _sandbox(wallet, scope):
    service = SandboxUsageService(
        wallet=wallet,
        publisher=InMemoryMeasurementPublisher(),
        turn_slots=InMemoryTurnSlots(),
        session_holds=InMemorySessionTurnHolds(),
        plan_for=no_plan,
    )
    return (await service.admit(scope=scope)).allowed


async def _tool(wallet, scope):
    billing = WalletManagedActionBilling(
        wallet=wallet, publisher=InMemoryMeasurementPublisher()
    )
    return await billing.admit(
        organization_id=scope.organization_id, action=ENRICH_PERSON
    )


ADMISSION_POINTS = pytest.mark.parametrize(
    "admit", [_gateway, _sandbox, _tool], ids=["gateway", "sandbox", "managed_tool"]
)


# Admission


@pytest.mark.parametrize("admit", [_sandbox, _tool], ids=["sandbox", "managed_tool"])
async def test_off_admits_without_reading_the_wallet(admit, wallet_on):
    wallet_on(False)
    wallet = _Wallet(allowed=False)

    assert await admit(wallet, _scope()) is True
    assert wallet.reads == 0


async def test_off_refuses_a_platform_funded_model_call_without_reading_the_wallet(
    wallet_on,
):
    """A `builtin` model runs on Agenta's own provider account, and off is not measured,
    so admitting it would serve the call free."""
    wallet_on(False)
    wallet = _Wallet(allowed=True)

    assert await _gateway(wallet, _scope()) is False
    assert wallet.reads == 0


@ADMISSION_POINTS
@pytest.mark.parametrize("allowed", [True, False])
async def test_on_is_the_wallets_answer(admit, wallet_on, allowed):
    wallet_on(True)
    wallet = _Wallet(allowed=allowed)

    assert await admit(wallet, _scope()) is allowed
    assert wallet.reads == 1


async def _hobby(organization_id):
    return DefaultPlan.CLOUD_V0_HOBBY.value


def _capped(slots, holds):
    return SandboxUsageService(
        wallet=_Wallet(allowed=True),
        publisher=InMemoryMeasurementPublisher(),
        turn_slots=slots,
        session_holds=holds,
        plan_for=_hobby,
    )


async def test_on_counts_the_turn_and_sets_the_plans_turn_limit(wallet_on):
    wallet_on(True)
    scope = _scope()
    slots = InMemoryTurnSlots()
    holds = InMemorySessionTurnHolds()

    admitted = await _capped(slots, holds).admit(
        scope=scope, turn_id="turn-1", session_id="sess-1"
    )

    assert admitted.allowed and admitted.slot_held
    assert admitted.turn_limit is not None
    assert holds.holds == {
        (scope.organization_id, "sess-1"): ("turn-1", admitted.turn_limit.seconds)
    }


async def test_on_refuses_a_turn_past_the_running_turns_cap(wallet_on):
    wallet_on(True)
    scope = _scope()
    slots = InMemoryTurnSlots()
    slots.held[scope.organization_id] = {"a", "b"}

    refused = await _capped(slots, InMemorySessionTurnHolds()).admit(
        scope=scope, turn_id="turn-3", session_id="sess-1"
    )

    assert not refused.allowed


# Measurement


async def _sink_published(scope):
    publisher = InMemoryMeasurementPublisher()
    await MeasurementUsageSink(publisher=publisher).record(
        scope=scope,
        target=_TARGET,
        outcome=GatewayOutcome(
            status_code=200,
            usage=GatewayUsage(input_tokens=10, output_tokens=5),
            origin=SecretOrigin.LOCAL,
        ),
        run_id=None,
    )
    return len(publisher.published)


async def _sandbox_published(scope):
    publisher = InMemoryMeasurementPublisher()
    measurement_id = await SandboxUsageService(
        wallet=_Wallet(),
        publisher=publisher,
        turn_slots=InMemoryTurnSlots(),
        session_holds=InMemorySessionTurnHolds(),
        plan_for=no_plan,
    ).record(
        scope=scope,
        interval=SandboxUsageInterval(
            provider="daytona",
            sandbox_id="sbx-1",
            start_time=START,
            end_time=START + timedelta(seconds=60),
            vcpu=1,
            memory_gib=1,
        ),
    )
    assert (measurement_id is None) is (not publisher.published)
    return len(publisher.published)


async def _tool_published(scope):
    publisher = InMemoryMeasurementPublisher()
    await WalletManagedActionBilling(wallet=_Wallet(), publisher=publisher).record(
        measurement=ManagedActionMeasurement(
            execution_id=f"tool_{uuid4().hex}",
            action=ENRICH_PERSON.key,
            provider=ENRICH_PERSON.binding.provider,
            unit=ENRICH_PERSON.unit,
            units=1,
            outcome=ManagedActionOutcome.SUCCEEDED,
            context=ManagedActionContext(
                organization_id=scope.organization_id,
                project_id=scope.project_id,
                user_id=scope.user_id,
                execution_id="tool_x",
            ),
            start_time=START,
            end_time=START,
        )
    )
    return len(publisher.published)


PRODUCERS = pytest.mark.parametrize(
    "produce",
    [_sink_published, _sandbox_published, _tool_published],
    ids=["gateway_sink", "sandbox_usage", "managed_tool"],
)


@PRODUCERS
@pytest.mark.parametrize("value, published", [(False, 0), (True, 1)])
async def test_only_off_skips_the_measurement(produce, wallet_on, value, published):
    wallet_on(value)

    assert await produce(_scope()) == published
