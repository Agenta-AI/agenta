"""Sandbox intervals reported by the runner: the measurement each one becomes, and its price.

Amounts are worked out by hand from the Daytona rows of the rate card: 75_600 musd per
vCPU-hour and 24_300 musd per GiB-hour of memory (Daytona's list price times 1.5).
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from oss.src.utils.context import AuthScope

from ee.src.core.measurements.charges import calculate_charge
from ee.src.core.measurements.rate_card import RATE_CARD_VERSION
from ee.src.core.measurements.sandboxes import (
    SandboxIntervalInvalidError,
    SandboxUsageInterval,
    SandboxUsageNotRecordedError,
    SandboxUsageService,
    sandbox_measurement,
)
from ee.src.core.wallets.contracts import GatewayKind
from ee.src.dbs.postgres.measurements.mappings import measurement_fingerprint
from ee.tests.pytest.utils.measurements.fakes import InMemoryMeasurementPublisher

START = datetime(2026, 9, 26, 12, 0, 0, tzinfo=timezone.utc)


def _scope() -> AuthScope:
    return AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


def _interval(**overrides) -> SandboxUsageInterval:
    values = dict(
        provider="daytona",
        sandbox_id="eb2931c3-10fd-4c5e-b3a0-8b46b3333694",
        start_time=START,
        end_time=START + timedelta(seconds=60),
        vcpu=2,
        memory_gib=4,
        session_id="session-1",
        agent_id=uuid4(),
    )
    values.update(overrides)
    return SandboxUsageInterval(**values)


def test_a_minute_of_our_standard_sandbox_costs_its_resource_seconds_at_list_times_1_5():
    command = sandbox_measurement(scope=_scope(), interval=_interval())

    values = {c.key: c.value for c in command.components}
    assert values == {
        "sandbox_seconds": 60,
        "vcpu_seconds": 120,
        "memory_gib_seconds": 240,
    }
    # (120 x 75_600 + 240 x 24_300) / 3600 = (9_072_000 + 5_832_000) / 3600 = 4140 musd:
    # $0.2484 an hour, Daytona's $0.1656 for 2 vCPU and 4 GiB, times 1.5.
    assert calculate_charge(command=command) == (4140, RATE_CARD_VERSION)


def test_a_partial_second_of_price_rounds_up_once():
    # 1 s at 1 vCPU and 1 GiB: (75_600 + 24_300) / 3600 = 27.75 -> 28 musd.
    command = sandbox_measurement(
        scope=_scope(),
        interval=_interval(end_time=START + timedelta(seconds=1), vcpu=1, memory_gib=1),
    )

    assert calculate_charge(command=command) == (28, RATE_CARD_VERSION)


def test_the_measurement_is_the_callers_and_names_the_sandbox():
    scope = _scope()
    interval = _interval()

    command = sandbox_measurement(scope=scope, interval=interval)

    assert command.gateway_kind == GatewayKind.SBX
    assert command.endpoint_kind == "builtin"
    assert (command.organization_id, command.project_id, command.user_id) == (
        scope.organization_id,
        scope.project_id,
        scope.user_id,
    )
    assert command.agent_id == interval.agent_id
    assert command.resource_key == "sbx:daytona"
    assert command.resource_locator == {
        "provider": "daytona",
        "sandbox_id": interval.sandbox_id,
        "vcpu": 2,
        "memory_gib": 4,
    }
    assert command.references == {"session": {"id": "session-1"}}
    assert (command.start_time, command.end_time) == (
        interval.start_time,
        interval.end_time,
    )


def test_a_retried_report_is_the_same_measurement():
    scope = _scope()
    interval = _interval()

    first = sandbox_measurement(scope=scope, interval=interval)
    retry = sandbox_measurement(scope=scope, interval=interval)

    assert first.measurement_id == retry.measurement_id
    assert measurement_fingerprint(first) == measurement_fingerprint(retry)


def test_the_same_sandbox_second_in_another_project_is_another_measurement():
    interval = _interval()

    mine = sandbox_measurement(scope=_scope(), interval=interval)
    theirs = sandbox_measurement(scope=_scope(), interval=interval)

    assert mine.measurement_id != theirs.measurement_id


def test_consecutive_intervals_are_distinct_measurements():
    scope = _scope()
    first = sandbox_measurement(scope=scope, interval=_interval())
    second = sandbox_measurement(
        scope=scope,
        interval=_interval(
            start_time=START + timedelta(seconds=60),
            end_time=START + timedelta(seconds=120),
        ),
    )

    assert first.measurement_id != second.measurement_id


@pytest.mark.parametrize(
    "overrides",
    [
        {"end_time": START},  # empty
        {"end_time": START - timedelta(seconds=1)},  # backwards
        {"end_time": START + timedelta(hours=1, seconds=1)},  # longer than an hour
        {"end_time": START + timedelta(seconds=1, milliseconds=500)},  # not whole
        {"start_time": START.replace(tzinfo=None)},  # naive
        {"vcpu": 0},
        {"memory_gib": 0},
        {"sandbox_id": "../escape"},
    ],
)
def test_an_interval_that_cannot_be_right_is_refused(overrides):
    with pytest.raises(ValidationError):
        _interval(**overrides)


def test_a_provider_the_card_does_not_price_is_refused_rather_than_stored():
    with pytest.raises(SandboxIntervalInvalidError):
        sandbox_measurement(scope=_scope(), interval=_interval(provider="local"))


class _Wallet:
    def __init__(self, allowed: bool):
        self.allowed = allowed
        self.checked = []

    async def check(self, *, organization_id):
        self.checked.append(organization_id)
        return self.allowed


@pytest.mark.asyncio
@pytest.mark.parametrize("allowed", [True, False])
async def test_admission_is_the_wallet_check_for_the_callers_organization(allowed):
    wallet = _Wallet(allowed)
    scope = _scope()
    service = SandboxUsageService(
        wallet=wallet, publisher=InMemoryMeasurementPublisher()
    )

    assert await service.admit(scope=scope) is allowed
    assert wallet.checked == [scope.organization_id]


@pytest.mark.asyncio
async def test_a_recorded_interval_is_published_once():
    publisher = InMemoryMeasurementPublisher()
    service = SandboxUsageService(wallet=_Wallet(True), publisher=publisher)

    measurement_id = await service.record(scope=_scope(), interval=_interval())

    [published] = publisher.published
    assert published.measurement_id == measurement_id


@pytest.mark.asyncio
async def test_an_unpublished_interval_is_reported_so_the_runner_retries_it():
    class _Refusing:
        async def publish(self, command):
            return False

    service = SandboxUsageService(wallet=_Wallet(True), publisher=_Refusing())

    with pytest.raises(SandboxUsageNotRecordedError):
        await service.record(scope=_scope(), interval=_interval())
