"""Managed tool actions on the wallet side: the rate card rows, the charge, worst-case
admission, and the measurement one execution becomes."""

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from oss.src.core.managed_tools.dtos import (
    ManagedActionContext,
    ManagedActionMeasurement,
    ManagedActionOutcome,
    ManagedActionProviderCost,
    ManagedActionUnit,
)
from oss.src.core.managed_tools.mock.actions import (
    ENRICH_PERSON,
    MOCK_ACTIONS,
    SEARCH_COMPANIES,
)

from ee.src.core.measurements import rate_card
from ee.src.core.measurements.charges import calculate_charge
from ee.src.core.measurements.rate_card import RATE_CARD_VERSION, ActionRates
from ee.src.core.measurements.tools import (
    ManagedActionUnpricedError,
    WalletManagedActionBilling,
    action_measurement,
    action_price,
)
from ee.src.core.wallets.contracts import GatewayKind
from ee.src.core.wallets.errors import UnpricedMeasurementError
from ee.src.core.wallets.service import WalletsService
from ee.tests.pytest.utils.measurements.fakes import InMemoryMeasurementPublisher
from ee.tests.pytest.utils.wallets.builders import build_general_wallet_balance
from ee.tests.pytest.utils.wallets.fakes import FakeWalletsDAO

NOW = datetime(2026, 9, 27, 12, 0, tzinfo=timezone.utc)


def _measurement(action=SEARCH_COMPANIES, units=3, **overrides):
    values = dict(
        execution_id=f"tool_{uuid4().hex}",
        action=action.key,
        provider=action.binding.provider,
        unit=action.unit,
        units=units,
        outcome=ManagedActionOutcome.SUCCEEDED,
        context=ManagedActionContext(
            organization_id=uuid4(),
            project_id=uuid4(),
            user_id=uuid4(),
            run_id="run-1",
            session_id="s-1",
            agent_id=str(uuid4()),
            execution_id="tool_x",
        ),
        start_time=NOW,
        end_time=NOW,
    )
    values.update(overrides)
    return ManagedActionMeasurement(**values)


def test_every_registered_action_has_a_rate_for_its_own_unit():
    for action in MOCK_ACTIONS:
        price = action_price(action.key)
        assert price is not None, action.key
        assert price.unit == action.unit


def test_a_per_result_rate_must_be_capped():
    with pytest.raises(ValueError):
        ActionRates(unit="action_results", musd_per_unit=1)


@pytest.mark.parametrize(
    "action, units, amount",
    [
        (ENRICH_PERSON, 1, 20_000),  # $0.02 per successful call
        (SEARCH_COMPANIES, 3, 6_000),  # 3 x $0.002
        (SEARCH_COMPANIES, 10, 20_000),
        (SEARCH_COMPANIES, 25, 20_000),  # capped at ten results
    ],
)
def test_the_charge_is_units_times_the_rate_capped(action, units, amount):
    command = action_measurement(_measurement(action, units))

    assert calculate_charge(command=command) == (amount, RATE_CARD_VERSION)


def test_a_failed_or_unknown_execution_is_not_charged():
    for outcome in (ManagedActionOutcome.FAILED, ManagedActionOutcome.UNKNOWN):
        command = action_measurement(_measurement(units=0, outcome=outcome))
        assert calculate_charge(command=command) is None


def test_an_unpriced_action_or_a_unit_the_rate_does_not_price_is_never_free():
    unknown = action_measurement(_measurement()).model_copy(
        update={"resource_locator": {"action": "mock.unknown", "unit": "action_calls"}}
    )
    with pytest.raises(UnpricedMeasurementError):
        calculate_charge(command=unknown)

    # The search rate prices results; a measurement that carries calls is not free.
    wrong_unit = action_measurement(_measurement(unit=ManagedActionUnit.CALLS, units=1))
    with pytest.raises(UnpricedMeasurementError):
        calculate_charge(command=wrong_unit)


def test_the_action_rates_are_part_of_the_rate_card_version(monkeypatch):
    before = rate_card._version()  # pylint: disable=protected-access
    monkeypatch.setitem(
        rate_card.ACTION_RATES,
        "mock.enrich_person",
        ActionRates(unit="action_calls", musd_per_unit=30_000),
    )
    assert rate_card._version() != before  # pylint: disable=protected-access


def test_one_execution_is_one_measurement_named_by_its_execution_id():
    measurement = _measurement(
        provider_reference="req-1",
        provider_cost=ManagedActionProviderCost(unit="credits", amount=2),
    )

    command = action_measurement(measurement)

    assert command.measurement_id == command.request_id == measurement.execution_id
    assert command.gateway_kind == GatewayKind.TOOL
    assert command.resource_key == "tool:mock.search_companies"
    assert command.resource_locator == {
        "action": "mock.search_companies",
        "provider": "mock_mcp",
        "unit": "action_results",
    }
    assert command.endpoint_kind == "builtin"
    assert [(c.key, c.value) for c in command.components] == [("action_results", 3)]
    assert command.organization_id == measurement.context.organization_id
    assert command.project_id == measurement.context.project_id
    assert str(command.agent_id) == measurement.context.agent_id
    assert command.references == {
        "execution": {
            "id": measurement.execution_id,
            "outcome": "succeeded",
            "provider_reference": "req-1",
            "provider_cost": {"unit": "credits", "amount": 2.0},
        },
        "workflow": {"gateway_run_id": "run-1"},
        "session": {"id": "s-1"},
    }


def _billing(balance_musd, floor_musd=0):
    dao = FakeWalletsDAO(
        general_balance=build_general_wallet_balance(
            balance_musd=balance_musd, floor_musd=floor_musd
        )
    )
    publisher = InMemoryMeasurementPublisher()
    billing = WalletManagedActionBilling(
        wallet=WalletsService(wallets_dao=dao), publisher=publisher
    )
    return billing, dao.general_balance.organization_id, publisher


@pytest.mark.parametrize(
    "balance, admitted",
    [(20_000, True), (19_999, False), (1, False), (0, False)],
)
async def test_admission_needs_the_worst_case_price_above_the_floor(balance, admitted):
    # Both mock actions cost at most 20_000 musd a call.
    billing, organization_id, _ = _billing(balance)

    for action in MOCK_ACTIONS:
        assert (
            await billing.admit(organization_id=organization_id, action=action)
            is admitted
        )


async def test_admission_counts_a_negative_floor():
    billing, organization_id, _ = _billing(5_000, floor_musd=-15_000)

    assert await billing.admit(organization_id=organization_id, action=ENRICH_PERSON)


async def test_admission_refuses_to_run_an_unpriced_action():
    billing, organization_id, _ = _billing(10_000_000)
    unpriced = ENRICH_PERSON.model_copy(update={"name": "unpriced"})

    with pytest.raises(ManagedActionUnpricedError):
        await billing.admit(organization_id=organization_id, action=unpriced)


async def test_covers_rejects_a_negative_amount():
    billing, organization_id, _ = _billing(10)

    with pytest.raises(ValueError):
        await billing.wallet.covers(organization_id=organization_id, amount_musd=-1)


async def test_the_listing_prices_come_from_the_rate_card():
    billing, _, _ = _billing(0)

    prices = await billing.prices()

    assert prices["mock.search_companies"].max_units_per_call == 10
    assert prices["mock.enrich_person"].worst_case_musd == 20_000


async def test_record_publishes_the_measurement():
    billing, _, publisher = _billing(0)
    measurement = _measurement()

    await billing.record(measurement=measurement)

    [command] = publisher.published
    assert command.measurement_id == measurement.execution_id
