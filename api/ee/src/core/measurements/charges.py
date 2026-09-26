"""What a measurement costs, from the rate card. A pure function of the measurement."""

from typing import Dict, Optional, Tuple

from ee.src.core.measurements.components import (
    CACHE_READ_TOKENS,
    CACHE_WRITE_TOKENS,
    INPUT_TOKENS,
    MEMORY_GIB_SECONDS,
    OUTPUT_TOKENS,
    REQUEST_COUNT,
    VCPU_SECONDS,
)
from ee.src.core.measurements.rate_card import (
    RATE_CARD_VERSION,
    request_rates_for,
    sandbox_rates_for,
    token_rates_for,
)
from ee.src.core.wallets.contracts import GatewayKind, MeasurementCommandV1
from ee.src.core.wallets.errors import UnpricedMeasurementError

# Only a `builtin` call runs on the platform's account (D30). `standard` and `custom`
# spend the customer's own credential and are never charged. A sandbox interval is
# reported only for a sandbox on the platform's own provider account, so it is `builtin`.
CHARGEABLE_ENDPOINT_KIND = "builtin"

_MICRO_PER_UNIT = 1_000_000
_SECONDS_PER_HOUR = 3600


def calculate_charge(*, command: MeasurementCommandV1) -> Optional[Tuple[int, str]]:
    """`(amount_musd, pricing_version)`, or None when the measurement is not charged.

    Not charged: the endpoint is not `builtin`, or every priced quantity is zero. A
    `builtin` measurement the card has no rate for raises `UnpricedMeasurementError`
    instead: an unknown price is not a zero price, and the measurement is retried and then
    dead-lettered rather than recorded as free.

    The products are exact integers and precision is lost once, at the final division,
    rounding up: at most one micro-dollar per measurement, and a positive charge never
    rounds to nothing.
    """
    if command.endpoint_kind != CHARGEABLE_ENDPOINT_KIND:
        return None

    values: Dict[str, int] = {c.key: c.value for c in command.components}
    locator = command.resource_locator

    # Each plane yields exact integer products and the one divisor that turns them into
    # micro-dollars: rates per million units divide by a million, hourly rates over
    # resource-seconds divide by the seconds in an hour.
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
        divisor = _MICRO_PER_UNIT
    elif command.gateway_kind == GatewayKind.MCP:
        rates = request_rates_for(server=locator.get("server"))
        if rates is None:
            raise UnpricedMeasurementError(resource_key=command.resource_key)
        total = values.get(REQUEST_COUNT, 0) * rates.musd_per_request
        divisor = 1
    elif command.gateway_kind == GatewayKind.SBX:
        rates = sandbox_rates_for(provider=locator.get("provider"))
        if rates is None:
            raise UnpricedMeasurementError(resource_key=command.resource_key)
        total = (
            values.get(VCPU_SECONDS, 0) * rates.vcpu_musd_per_hour
            + values.get(MEMORY_GIB_SECONDS, 0) * rates.memory_gib_musd_per_hour
        )
        divisor = _SECONDS_PER_HOUR
    else:
        raise UnpricedMeasurementError(resource_key=command.resource_key)

    if total <= 0:
        return None
    return -(-total // divisor), RATE_CARD_VERSION
