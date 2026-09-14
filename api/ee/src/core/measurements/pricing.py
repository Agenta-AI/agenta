"""Wave 1 FIXTURE pricing — a fixed rate per resource kind held in this package.

This is deliberately NOT real pricing. It exists so the measurement worker can
exercise the full measure -> price -> debit chain against the wallet-owned fakes.
A later wave replaces this with versioned, gateway-owned pricing configuration.
"""

from math import ceil
from typing import Optional, Tuple

from ee.src.core.wallets.contracts import GatewayKind, MeasurementCommandV1

PRICING_VERSION = "wallet-v1-fake-1"

# Applied to observed provider cost (sum of `components[].cost_musd`) before charging.
FIXTURE_MARKUP = 1.05

# Fallback flat charge when an LLM measurement carries no component cost at all.
FIXTURE_LLM_FLAT_MUSD = 100

# Flat per-`request_count` charge for MCP, which carries no cost components.
FIXTURE_MCP_RATE_MUSD_PER_REQUEST = 50

# Only a "managed" endpoint is a gateway-priced charge; free/BYOK/custom activity
# is a measurement with no debit (docs/design/wallets-research/v1/entities.md
# "A measurement can have no debit").
CHARGEABLE_ENDPOINT_KIND = "managed"


def calculate_fake_charge(
    *, command: MeasurementCommandV1
) -> Optional[Tuple[int, str]]:
    """Return `(amount_musd, pricing_version)`, or `None` if this measurement is
    not charged. Never returns a non-positive amount."""

    if command.endpoint_kind != CHARGEABLE_ENDPOINT_KIND:
        return None

    if command.gateway_kind == GatewayKind.LLM:
        observed_cost_musd = sum(
            component.cost_musd or 0 for component in command.components
        )
        base_musd = (
            observed_cost_musd if observed_cost_musd > 0 else FIXTURE_LLM_FLAT_MUSD
        )
        amount_musd = ceil(base_musd * FIXTURE_MARKUP)
    elif command.gateway_kind == GatewayKind.MCP:
        request_count = sum(
            component.value
            for component in command.components
            if component.key == "request_count"
        )
        amount_musd = FIXTURE_MCP_RATE_MUSD_PER_REQUEST * max(request_count, 1)
    else:
        # SBX and any future gateway kind: no Wave 1 fixture, so no charge.
        return None

    return max(amount_musd, 1), PRICING_VERSION
