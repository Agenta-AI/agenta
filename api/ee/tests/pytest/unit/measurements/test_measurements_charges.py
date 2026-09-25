"""The rate card and the charge it produces.

Amounts are pinned to integers worked out by hand from the synthetic mock rates in
`ee/src/core/measurements/rate_card.py`, never asserted as `> 0`, so a changed rate is a
reviewable edit here and an accidental one is a failure.
"""

import pytest

from oss.src.core.gateways.llms.catalog import (
    BUILTIN_LLM_PROVIDERS,
    builtin_llm_endpoint,
)
from oss.src.utils.env import env

from ee.src.core.measurements import rate_card
from ee.src.core.measurements.charges import calculate_charge
from ee.src.core.measurements.rate_card import (
    RATE_CARD_VERSION,
    RequestRates,
    token_rates_for,
)
from ee.src.core.wallets.contracts import MeasurementComponentV1
from ee.src.core.wallets.errors import UnpricedMeasurementError
from ee.tests.pytest.utils.measurements.fakes import InMemoryMeasurementPublisher
from ee.tests.pytest.utils.measurements.mcp_producer import publish_mcp_measurement
from ee.tests.pytest.utils.wallets.builders import build_measurement_command
from uuid import uuid4


def _llm(**values: int):
    return build_measurement_command(
        components=[
            MeasurementComponentV1(key=key, value=value)
            for key, value in values.items()
        ]
    )


def test_every_token_kind_is_priced_at_its_own_rate_and_request_count_is_free():
    command = _llm(
        request_count=1,
        input_tokens=200,
        cache_read_tokens=1000,
        cache_write_tokens=50,
        output_tokens=380,
    )

    # 200 x 1_000_000 + 1000 x 100_000 + 50 x 1_250_000 + 380 x 4_000_000
    # = 200_000_000 + 100_000_000 + 62_500_000 + 1_520_000_000 = 1_882_500_000
    # micro-musd; / 1_000_000, rounded up = 1883 musd.
    assert calculate_charge(command=command) == (1883, RATE_CARD_VERSION)


@pytest.mark.parametrize(
    "values, amount",
    [
        ({"cache_read_tokens": 10}, 1),  # exactly 1_000_000: one micro-dollar
        ({"cache_read_tokens": 11}, 2),  # 1_100_000: rounds up, never down
        ({"cache_read_tokens": 1}, 1),  # a positive charge never rounds to nothing
        ({"input_tokens": 3}, 3),
    ],
)
def test_the_total_is_rounded_up_once(values, amount):
    assert calculate_charge(command=_llm(**values)) == (amount, RATE_CARD_VERSION)


def test_a_call_that_used_no_priced_quantity_is_not_charged():
    assert calculate_charge(command=_llm(request_count=1, input_tokens=0)) is None


@pytest.mark.parametrize("endpoint_kind", ["standard", "custom"])
def test_a_call_on_the_customers_own_credential_is_never_charged(endpoint_kind):
    command = build_measurement_command(endpoint_kind=endpoint_kind)

    assert calculate_charge(command=command) is None


def test_an_unpriced_builtin_model_is_not_a_free_one():
    command = build_measurement_command(
        resource_key="llm:mock:not-on-the-card",
        resource_locator={"provider": "mock", "model": "not-on-the-card"},
    )

    with pytest.raises(UnpricedMeasurementError):
        calculate_charge(command=command)


def test_a_builtin_measurement_of_a_kind_the_card_does_not_price_is_unpriced():
    with pytest.raises(UnpricedMeasurementError):
        calculate_charge(command=build_measurement_command(gateway_kind="sbx"))


@pytest.mark.asyncio
@pytest.mark.parametrize("request_count, amount", [(1, 50), (3, 150)])
async def test_mcp_keeps_the_flat_per_request_charge_it_had(request_count, amount):
    command = await publish_mcp_measurement(
        project_id=uuid4(),
        publisher=InMemoryMeasurementPublisher(),
        request_count=request_count,
    )

    assert calculate_charge(command=command) == (amount, RATE_CARD_VERSION)


@pytest.mark.asyncio
async def test_an_unpriced_mcp_server_is_not_a_free_one():
    command = await publish_mcp_measurement(
        project_id=uuid4(), publisher=InMemoryMeasurementPublisher(), server="unknown"
    )

    with pytest.raises(UnpricedMeasurementError):
        calculate_charge(command=command)


def test_the_version_changes_whenever_any_rate_does(monkeypatch):
    assert rate_card._version() == RATE_CARD_VERSION

    monkeypatch.setitem(
        rate_card.REQUEST_RATES, "agenta", RequestRates(musd_per_request=51)
    )

    assert rate_card._version() != RATE_CARD_VERSION


def test_every_model_the_builtin_namespace_serves_has_a_rate(monkeypatch):
    """Open-design item 19. The `builtin` catalogue is code, so a model added to it
    without a rate fails here rather than as a dead-lettered measurement in production."""
    monkeypatch.setattr(env.mock_gateways, "enabled", True)
    served = [
        (provider, model)
        for provider in BUILTIN_LLM_PROVIDERS
        for model in builtin_llm_endpoint(provider_key=provider).data.models.enumerate()
    ]

    assert served
    assert [
        (provider, model)
        for provider, model in served
        if token_rates_for(provider=provider, model=model) is None
    ] == []
