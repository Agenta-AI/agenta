"""One gateway call becomes one measurement: the mapping from the gateway's DTOs to the
envelope, asserted by value."""

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
from oss.src.utils.context import AuthScope

from ee.src.core.measurements.charges import calculate_charge
from ee.src.core.measurements.sink import MeasurementUsageSink
from ee.tests.pytest.utils.measurements.fakes import InMemoryMeasurementPublisher


def _scope() -> AuthScope:
    return AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


def _target(**overrides) -> GatewayTarget:
    defaults = dict(
        plane=GatewayPlane.LLM,
        namespace=GatewayEndpointNamespace.BUILTIN,
        name="mock",
        provider="mock",
        model="gpt-5.5",
    )
    defaults.update(overrides)
    return GatewayTarget(**defaults)


def _outcome(**usage) -> GatewayOutcome:
    return GatewayOutcome(
        status_code=200, usage=GatewayUsage(**usage), origin=SecretOrigin.LOCAL
    )


async def _record(*, target=None, outcome=None, run_id=None, scope=None):
    publisher = InMemoryMeasurementPublisher()
    await MeasurementUsageSink(publisher=publisher).record(
        scope=scope or _scope(),
        target=target or _target(),
        outcome=outcome or _outcome(input_tokens=11, output_tokens=7),
        run_id=run_id,
    )
    [command] = publisher.attempts
    return command


@pytest.mark.asyncio
async def test_one_call_is_one_measurement_with_the_gateways_vocabulary():
    scope = _scope()

    command = await _record(scope=scope, run_id="run-1")

    assert command.measurement_id.startswith("msr_")
    assert command.request_id == command.measurement_id
    assert (command.organization_id, command.project_id, command.user_id) == (
        scope.organization_id,
        scope.project_id,
        scope.user_id,
    )
    assert command.agent_id is None
    assert command.gateway_kind == "llm"
    assert command.resource_key == "llm:mock:gpt-5.5"
    assert command.resource_locator == {
        "provider": "mock",
        "model": "gpt-5.5",
        "endpoint_id": None,
    }
    assert command.endpoint_id is None
    assert command.endpoint_kind == "builtin"
    assert command.references == {"workflow": {"gateway_run_id": "run-1"}}


@pytest.mark.asyncio
async def test_a_call_on_no_run_carries_no_reference_at_all():
    assert (await _record(run_id=None)).references == {}


@pytest.mark.asyncio
async def test_an_endpoint_row_id_is_carried_as_a_string():
    endpoint_id = uuid4()

    command = await _record(target=_target(endpoint_id=endpoint_id))

    assert command.endpoint_id == str(endpoint_id)
    assert command.resource_locator["endpoint_id"] == str(endpoint_id)


@pytest.mark.asyncio
async def test_each_reported_quantity_is_one_component_and_an_unreported_one_is_none():
    command = await _record(
        outcome=_outcome(
            input_tokens=200, cache_read_tokens=1000, output_tokens=380, cost=0.5
        )
    )

    assert {c.key: c.value for c in command.components} == {
        "request_count": 1,
        "input_tokens": 200,
        "cache_read_tokens": 1000,
        "output_tokens": 380,
    }
    assert all(c.cost_musd is None for c in command.components)


@pytest.mark.asyncio
async def test_every_key_the_sink_emits_is_one_the_card_prices():
    """The producer and the pricer meet only through the component keys, so a producer
    key the card ignored would be silently free. Every token kind moves the charge."""
    command = await _record(
        outcome=_outcome(
            input_tokens=1, cache_read_tokens=1, cache_write_tokens=1, output_tokens=1
        )
    )
    base, _ = calculate_charge(command=command)

    for key in ("input_tokens", "cache_read_tokens", "cache_write_tokens"):
        bumped = command.model_copy(
            update={
                "components": [
                    c.model_copy(update={"value": 1_000_000}) if c.key == key else c
                    for c in command.components
                ]
            }
        )
        assert calculate_charge(command=bumped)[0] > base, key


@pytest.mark.asyncio
async def test_a_refused_publish_returns_rather_than_raises():
    publisher = InMemoryMeasurementPublisher()
    publisher.fail_next = True

    await MeasurementUsageSink(publisher=publisher).record(
        scope=_scope(), target=_target(), outcome=_outcome(input_tokens=1), run_id=None
    )

    assert len(publisher.attempts) == 1
    assert publisher.published == []
