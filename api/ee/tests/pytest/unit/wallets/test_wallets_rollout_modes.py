"""The `wallets-rollout` mode at every admission point and every measurement producer.

`off` admits without reading the wallet and measures nothing. `shadow` reads the wallet,
never refuses, and measures everything. `enforce` is the wallet's answer, as before.
"""

import asyncio
import time
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
from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.policy import service as policy_service_module
from oss.src.core.gateways.policy.dtos import PolicyDecision
from oss.src.core.gateways.policy.service import (
    SPEND_ADMISSION_TIMEOUT_SECONDS,
    GatewayPolicyService,
)
from oss.src.core.rollout import switches
from oss.src.core.rollout.switches import WalletMode
from oss.src.utils.env import env
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
        async def _mode(organization_id, **_kwargs):
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


# Through the gateway's own bounds, with the real rollout lookup


class _SlowPostHog:
    def __init__(self, payload, delay):
        self.payload = payload
        self.delay = delay

    def get_feature_flag_payload(self, flag, distinct_id):
        time.sleep(self.delay)
        return self.payload


@pytest.fixture
def real_rollout(monkeypatch):
    """The real `wallet_mode_for`, with the rollout flags on and no shared cache."""
    monkeypatch.setattr(admission, "wallet_mode_for", switches.wallet_mode_for)
    monkeypatch.setattr(env.wallets, "enabled", True)
    monkeypatch.setattr(env.rollout, "enabled", True)

    async def _miss(**_kwargs):
        return None

    monkeypatch.setattr(switches, "get_cache", _miss)
    monkeypatch.setattr(switches, "set_cache", _miss)
    switches._payloads.clear()
    switches._refreshes.clear()
    yield
    switches._payloads.clear()
    switches._refreshes.clear()


class _StuckWallet:
    async def check(self, *, organization_id):
        await asyncio.sleep(10)
        return False


def _policy(publisher=None):
    return GatewayPolicyService(
        resolver=None,
        spend_admission=WalletSpendAdmission(wallet=_StuckWallet()),
        usage_sink=MeasurementUsageSink(
            publisher=publisher or InMemoryMeasurementPublisher()
        ),
    )


async def test_shadow_admits_inside_the_gateways_bound_even_with_a_stuck_wallet(
    real_rollout, monkeypatch
):
    scope = _scope()
    switches._payloads[switches.WALLETS_ROLLOUT_FLAG] = (
        time.monotonic(),
        {str(scope.organization_id): "shadow"},
    )

    started = time.monotonic()
    result = await _policy().admit(scope=scope, target=_TARGET)

    assert result.allowed is True
    assert time.monotonic() - started < SPEND_ADMISSION_TIMEOUT_SECONDS


class _SlowToCancelWallet:
    """A check whose cancellation cleanup is itself slow, as a closing DB session can be."""

    async def check(self, *, organization_id):
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            await asyncio.sleep(1.5)
            raise
        return False


async def test_shadow_admits_even_when_the_checks_cancellation_is_slow(real_rollout):
    scope = _scope()
    switches._payloads[switches.WALLETS_ROLLOUT_FLAG] = (
        time.monotonic(),
        {str(scope.organization_id): "shadow"},
    )
    policy = GatewayPolicyService(
        resolver=None,
        spend_admission=WalletSpendAdmission(wallet=_SlowToCancelWallet()),
    )

    started = time.monotonic()
    result = await policy.admit(scope=scope, target=_TARGET)

    assert result.allowed is True
    assert time.monotonic() - started < SPEND_ADMISSION_TIMEOUT_SECONDS


async def test_a_slow_first_lookup_admits_inside_the_gateways_bound(
    real_rollout, monkeypatch
):
    scope = _scope()
    monkeypatch.setattr(
        switches,
        "_load_posthog",
        lambda: _SlowPostHog({str(scope.organization_id): "shadow"}, delay=1.2),
    )

    started = time.monotonic()
    result = await _policy().admit(scope=scope, target=_TARGET)

    assert result.allowed is True
    assert time.monotonic() - started < SPEND_ADMISSION_TIMEOUT_SECONDS


@pytest.mark.parametrize(
    "age",
    [switches.ROLLOUT_CACHE_TTL_SECONDS + 1, switches.ROLLOUT_MAX_STALE_SECONDS + 1],
    ids=["stale", "past-the-stale-limit"],
)
async def test_an_expired_payload_never_delays_the_measurement_past_its_bound(
    real_rollout, monkeypatch, age
):
    # The payload expired during a long provider call and PostHog is slow: the hand-off
    # still publishes inside its 0.5s bound, on the payload its admission read.
    scope = _scope()
    switches._payloads[switches.WALLETS_ROLLOUT_FLAG] = (
        time.monotonic() - age,
        {str(scope.organization_id): "enforce"},
    )
    monkeypatch.setattr(
        switches,
        "_load_posthog",
        lambda: _SlowPostHog({str(scope.organization_id): "enforce"}, delay=1.0),
    )
    publisher = InMemoryMeasurementPublisher()

    async def _no_audit(**_kwargs):
        return None

    monkeypatch.setattr(policy_service_module, "publish_gateway_call", _no_audit)

    await _policy(publisher).record(
        scope=scope,
        target=_TARGET,
        decision=PolicyDecision(allowed=True, permission=Permission.USE_LLM_ENDPOINTS),
        outcome=GatewayOutcome(
            status_code=200,
            usage=GatewayUsage(input_tokens=3, output_tokens=2),
            origin=SecretOrigin.LOCAL,
        ),
    )

    assert len(publisher.published) == 1
