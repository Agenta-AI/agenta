"""Wave 1 fixture pricing: the exact fake amount for chargeable measurements,
nothing for a result the gateway does not charge.

Every amount below is pinned to an exact integer derived by hand from the fixture
rate card in `ee/src/core/measurements/pricing.py`, not asserted as `> 0`. A
`> 0` assertion passes for any rate card at all: multiplying `FIXTURE_MARKUP` by a
thousand left the whole module green. The arithmetic for each pinned value is shown
in the test so a deliberate price change is a one-line, reviewable edit here, and an
accidental one is a failure.
"""

from ee.src.core.measurements.pricing import PRICING_VERSION, calculate_fake_charge
from ee.tests.pytest.utils.wallets.builders import (
    build_llm_component,
    build_mcp_component,
    build_measurement_command,
)

# The default LLM component built by `build_llm_component` carries
# `cost_musd=240`, the only cost component on the default measurement command.
DEFAULT_OBSERVED_LLM_COST_MUSD = 240

# ceil(240 * 1.05) — observed provider cost times FIXTURE_MARKUP.
EXPECTED_LLM_CHARGE_MUSD = 252

# ceil(100 * 1.05) — FIXTURE_LLM_FLAT_MUSD times FIXTURE_MARKUP, the fallback
# taken when an LLM measurement reports no component cost at all.
EXPECTED_LLM_FLAT_CHARGE_MUSD = 105

# FIXTURE_MCP_RATE_MUSD_PER_REQUEST (50) * request_count. MCP carries no cost
# components, so the markup never applies to it.
EXPECTED_MCP_SINGLE_REQUEST_CHARGE_MUSD = 50
EXPECTED_MCP_THREE_REQUEST_CHARGE_MUSD = 150


def test_fake_charge_is_positive_for_managed_llm_measurement():
    command = build_measurement_command(endpoint_kind="managed")

    charge = calculate_fake_charge(command=command)

    assert charge is not None
    amount_musd, pricing_version = charge
    # Pins both the observed-cost pass-through and the markup: a changed
    # FIXTURE_MARKUP moves this number.
    assert amount_musd == EXPECTED_LLM_CHARGE_MUSD
    assert pricing_version == PRICING_VERSION


def test_fake_charge_scales_with_observed_llm_cost():
    """The LLM charge tracks the measurement's own cost components, so pinning a
    single amount cannot tell a cost pass-through from a flat rate that happens to
    land on the same number. Double the observed cost, double the charge."""

    command = build_measurement_command(
        endpoint_kind="managed",
        components=[build_llm_component(cost_musd=DEFAULT_OBSERVED_LLM_COST_MUSD * 2)],
    )

    charge = calculate_fake_charge(command=command)

    assert charge is not None
    amount_musd, _ = charge
    # ceil(480 * 1.05)
    assert amount_musd == 504


def test_fake_charge_is_positive_for_managed_mcp_measurement():
    command = build_measurement_command(
        gateway_kind="mcp",
        endpoint_kind="managed",
        components=[build_mcp_component()],
    )

    charge = calculate_fake_charge(command=command)

    assert charge is not None
    amount_musd, pricing_version = charge
    assert amount_musd == EXPECTED_MCP_SINGLE_REQUEST_CHARGE_MUSD
    assert pricing_version == PRICING_VERSION


def test_fake_charge_scales_with_mcp_request_count():
    """One request cannot distinguish a per-request rate from a flat per-call
    charge, and the `max(request_count, 1)` floor hides a dropped count. Three
    requests pin the rate itself."""

    command = build_measurement_command(
        gateway_kind="mcp",
        endpoint_kind="managed",
        components=[build_mcp_component(value=3)],
    )

    charge = calculate_fake_charge(command=command)

    assert charge is not None
    amount_musd, _ = charge
    assert amount_musd == EXPECTED_MCP_THREE_REQUEST_CHARGE_MUSD


def test_fake_charge_falls_back_to_flat_llm_rate_with_no_cost_components():
    command = build_measurement_command(
        endpoint_kind="managed",
        components=[],
    )

    charge = calculate_fake_charge(command=command)

    assert charge is not None
    amount_musd, pricing_version = charge
    assert amount_musd == EXPECTED_LLM_FLAT_CHARGE_MUSD
    assert pricing_version == PRICING_VERSION


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
