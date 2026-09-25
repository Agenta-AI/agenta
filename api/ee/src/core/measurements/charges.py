"""What a measurement costs, from the rate card. A pure function of the measurement."""

from typing import Dict, Optional, Tuple

from ee.src.core.measurements.components import (
    CACHE_READ_TOKENS,
    CACHE_WRITE_TOKENS,
    INPUT_TOKENS,
    OUTPUT_TOKENS,
    REQUEST_COUNT,
)
from ee.src.core.measurements.rate_card import (
    RATE_CARD_VERSION,
    request_rates_for,
    token_rates_for,
)
from ee.src.core.wallets.contracts import GatewayKind, MeasurementCommandV1
from ee.src.core.wallets.errors import UnpricedMeasurementError

# Only a `builtin` call runs on the platform's account (D30). `standard` and `custom`
# spend the customer's own credential and are never charged.
CHARGEABLE_ENDPOINT_KIND = "builtin"

_MICRO_PER_UNIT = 1_000_000


def calculate_charge(*, command: MeasurementCommandV1) -> Optional[Tuple[int, str]]:
    """`(amount_musd, pricing_version)`, or None when the measurement is not charged.

    Not charged: the endpoint is not `builtin`, or every priced quantity is zero. A
    `builtin` measurement the card has no rate for raises `UnpricedMeasurementError`
    instead: an unknown price is not a zero price, and the measurement is retried and then
    dead-lettered rather than recorded as free.

    Rates are per million, so the products are exact integers in micro-micro-dollars and
    precision is lost once, at the final division, rounding up: at most one micro-dollar
    per call, and a positive charge never rounds to nothing.
    """
    if command.endpoint_kind != CHARGEABLE_ENDPOINT_KIND:
        return None

    values: Dict[str, int] = {c.key: c.value for c in command.components}
    locator = command.resource_locator

    if command.gateway_kind == GatewayKind.LLM:
        rates = token_rates_for(
            provider=locator.get("provider"), model=locator.get("model")
        )
        if rates is None:
            raise UnpricedMeasurementError(resource_key=command.resource_key)
        total = (
            values.get(INPUT_TOKENS, 0) * rates.input_musd_per_million
            + values.get(CACHE_READ_TOKENS, 0) * rates.cache_read_musd_per_million
            + values.get(CACHE_WRITE_TOKENS, 0) * rates.cache_write_musd_per_million
            + values.get(OUTPUT_TOKENS, 0) * rates.output_musd_per_million
        )
    elif command.gateway_kind == GatewayKind.MCP:
        rates = request_rates_for(server=locator.get("server"))
        if rates is None:
            raise UnpricedMeasurementError(resource_key=command.resource_key)
        total = values.get(REQUEST_COUNT, 0) * rates.musd_per_request * _MICRO_PER_UNIT
    else:
        raise UnpricedMeasurementError(resource_key=command.resource_key)

    if total <= 0:
        return None
    return -(-total // _MICRO_PER_UNIT), RATE_CARD_VERSION
