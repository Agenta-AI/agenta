"""The `wallets-rollout` mode at every admission point and every measurement producer.

`off` admits without reading the wallet and measures nothing. `shadow` reads the wallet,
never refuses, and measures everything. `enforce` is the wallet's answer, as before.
"""

import asyncio
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
from oss.src.core.rollout.switches import WalletMode
from oss.src.utils.context import AuthScope

from ee.src.core.measurements.sandboxes import (
    SandboxUsageInterval,
    SandboxUsageService,
)
from ee.src.core.measurements.sink import MeasurementUsageSink
from ee.src.core.measurements.tools import WalletManagedActionBilling
from ee.src.core.wallets import admission
from ee.src.core.wallets.admission import WalletSpendAdmission
from ee.tests.pytest.utils.measurements.fakes import InMemoryMeasurementPublisher

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
def mode(monkeypatch):
    """Set the mode `wallet_mode_for` answers, overriding the suite's `enforce`."""

    def _set(value: WalletMode) -> None:
        async def _mode(organization_id):
            return value

        monkeypatch.setattr(admission, "wallet_mode_for", _mode)

    return _set


async def _gateway(wallet, scope):
    result = await WalletSpendAdmission(wallet=wallet).admit(
        scope=scope, target=_TARGET
    )
    return result.allowed


async def _sandbox(wallet, scope):
    service = SandboxUsageService(
        wallet=wallet, publisher=InMemoryMeasurementPublisher()
    )
    return await service.admit(scope=scope)


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


@ADMISSION_POINTS
async def test_off_admits_without_reading_the_wallet(admit, mode):
    mode(WalletMode.OFF)
    wallet = _Wallet(allowed=False)

    assert await admit(wallet, _scope()) is True
    assert wallet.reads == 0


@ADMISSION_POINTS
async def test_shadow_reads_the_wallet_and_never_refuses(admit, mode):
    mode(WalletMode.SHADOW)
    wallet = _Wallet(allowed=False)

    assert await admit(wallet, _scope()) is True
    assert wallet.reads == 1


@ADMISSION_POINTS
async def test_shadow_admits_when_the_wallet_cannot_answer(admit, mode):
    mode(WalletMode.SHADOW)

    assert await admit(_Wallet(raises=True), _scope()) is True


@ADMISSION_POINTS
@pytest.mark.parametrize("allowed", [True, False])
async def test_enforce_is_the_wallets_answer(admit, mode, allowed):
    mode(WalletMode.ENFORCE)
    wallet = _Wallet(allowed=allowed)

    assert await admit(wallet, _scope()) is allowed
    assert wallet.reads == 1


async def test_enforce_propagates_a_wallet_that_cannot_answer(mode):
    # The callers fail closed on a raise; enforce must not swallow it.
    mode(WalletMode.ENFORCE)

    with pytest.raises(RuntimeError):
        await admission.admit_in_mode(
            organization_id=uuid4(),
            point="test",
            check=lambda: _Wallet(raises=True).check(organization_id=None),
        )


async def test_a_slow_wallet_in_shadow_admits_within_the_outer_bound(mode, monkeypatch):
    mode(WalletMode.SHADOW)
    monkeypatch.setattr(admission, "SHADOW_CHECK_TIMEOUT_SECONDS", 0.01)

    async def _slow():
        await asyncio.sleep(1)
        return False

    assert (
        await admission.admit_in_mode(organization_id=uuid4(), point="t", check=_slow)
        is True
    )


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
        wallet=_Wallet(), publisher=publisher
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
@pytest.mark.parametrize(
    "value, published",
    [(WalletMode.OFF, 0), (WalletMode.SHADOW, 1), (WalletMode.ENFORCE, 1)],
)
async def test_only_off_skips_the_measurement(produce, mode, value, published):
    mode(value)

    assert await produce(_scope()) == published
