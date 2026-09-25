"""Our price list for platform-funded (`builtin`) gateway usage.

Integer micro-dollars throughout, per million tokens or per request. A price change is a
change to this file, reviewed and approved by product; nothing else sets a price.

Every rate here is SYNTHETIC and is not an approved price: the only models `builtin`
serves today are the mock provider's, behind `env.mock_gateways.enabled`, so this card
bills nothing real. A real `builtin` provider brings its own rows, with their source and
date.
"""

from hashlib import sha256
from typing import Dict, Optional, Tuple

from orjson import OPT_SORT_KEYS, dumps
from pydantic import BaseModel


class TokenRates(BaseModel):
    """Our price for one million tokens of each kind, in micro-dollars."""

    input_musd_per_million: int
    cache_read_musd_per_million: int
    cache_write_musd_per_million: int
    output_musd_per_million: int


class RequestRates(BaseModel):
    """A flat price per call, for a plane that is not priced by tokens (MCP)."""

    musd_per_request: int


_MOCK_RATES = TokenRates(
    input_musd_per_million=1_000_000,  # $1.00 / M
    cache_read_musd_per_million=100_000,  # $0.10 / M
    cache_write_musd_per_million=1_250_000,  # $1.25 / M
    output_musd_per_million=4_000_000,  # $4.00 / M
)

# Keyed by the gateway's own vocabulary: (provider, model) as the producer writes them
# into `resource_locator`.
TOKEN_RATES: Dict[Tuple[str, str], TokenRates] = {
    (provider, model): _MOCK_RATES
    for provider in ("agenta", "mock")
    for model in ("mock/echo", "gpt-5.5", "claude-sonnet-5")
}

# Keyed by MCP server, the key the MCP plane writes into `resource_locator`. Carried over
# from the Wave 1 fixture so a `builtin` MCP call still charges what it did.
REQUEST_RATES: Dict[str, RequestRates] = {
    "agenta": RequestRates(musd_per_request=50),
}


def _version() -> str:
    """Derived from the table itself, so a rate cannot change without the version that
    every debit carries changing with it."""
    table = {
        "tokens": {
            f"{provider}:{model}": rates.model_dump()
            for (provider, model), rates in TOKEN_RATES.items()
        },
        "requests": {
            server: rates.model_dump() for server, rates in REQUEST_RATES.items()
        },
    }
    return "rc-" + sha256(dumps(table, option=OPT_SORT_KEYS)).hexdigest()[:12]


RATE_CARD_VERSION = _version()


def token_rates_for(*, provider: str, model: str) -> Optional[TokenRates]:
    """The rates for one model, or None when the card does not price it."""
    return TOKEN_RATES.get((provider, model))


def request_rates_for(*, server: str) -> Optional[RequestRates]:
    """The per-request rate for one MCP server, or None when the card does not price it."""
    return REQUEST_RATES.get(server)
