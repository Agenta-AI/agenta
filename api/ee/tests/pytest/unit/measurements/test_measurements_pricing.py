"""Wave 1 fixture pricing: positive fake amount for chargeable measurements,
nothing for a result the gateway does not charge."""

from ee.src.core.measurements.pricing import PRICING_VERSION, calculate_fake_charge
from ee.tests.pytest.utils.wallets.builders import (
    build_mcp_component,
    build_measurement_command,
)


def test_fake_charge_is_positive_for_managed_llm_measurement():
    command = build_measurement_command(endpoint_kind="managed")

    charge = calculate_fake_charge(command=command)

    assert charge is not None
    amount_musd, pricing_version = charge
    assert amount_musd > 0
    assert pricing_version == PRICING_VERSION


def test_fake_charge_is_positive_for_managed_mcp_measurement():
    command = build_measurement_command(
        gateway_kind="mcp",
        endpoint_kind="managed",
        components=[build_mcp_component()],
    )

    charge = calculate_fake_charge(command=command)

    assert charge is not None
    amount_musd, _ = charge
    assert amount_musd > 0


def test_fake_charge_falls_back_to_flat_llm_rate_with_no_cost_components():
    command = build_measurement_command(
        endpoint_kind="managed",
        components=[],
    )

    charge = calculate_fake_charge(command=command)

    assert charge is not None
    amount_musd, _ = charge
    assert amount_musd > 0


def test_non_managed_endpoint_publishes_no_charge():
    command = build_measurement_command(endpoint_kind="custom")

    assert calculate_fake_charge(command=command) is None


def test_sbx_gateway_kind_has_no_wave1_fixture():
    command = build_measurement_command(
        gateway_kind="sbx",
        endpoint_kind="managed",
        components=[],
    )

    assert calculate_fake_charge(command=command) is None
