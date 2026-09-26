"""Our price list for platform-funded (`builtin`) usage: gateway calls and sandbox time.

Integer micro-dollars throughout, per million tokens, per request, or per resource-hour. A price change is a
change to this file, reviewed and approved by product; nothing else sets a price.

Every token and request rate here is SYNTHETIC and is not an approved price: the only
models `builtin` serves today are the mock provider's, behind `env.mock_gateways.enabled`.
A real `builtin` provider brings its own rows, with their source and date, as the sandbox
rows below do.
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


class SandboxRates(BaseModel):
    """Our price for one hour of each resource a running sandbox has, in micro-dollars.
    Charged per second of the hour."""

    vcpu_musd_per_hour: int
    memory_gib_musd_per_hour: int


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


# Keyed by sandbox provider, the key the runner's usage report writes into
# `resource_locator`. Daytona's list price (daytona.io/pricing, read 2026-09-26) is
# $0.0504 per vCPU-hour and $0.0162 per GiB-hour of memory, billed per second; ours is
# that times 1.5. Disk is not charged: our sandboxes use 5 GiB, inside Daytona's 5 free
# GiB. Only running seconds are metered, so a stopped sandbox's disk is not charged either.
SANDBOX_RATES: Dict[str, SandboxRates] = {
    "daytona": SandboxRates(
        vcpu_musd_per_hour=75_600,  # 50_400 x 1.5
        memory_gib_musd_per_hour=24_300,  # 16_200 x 1.5
    ),
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
        "sandboxes": {
            provider: rates.model_dump() for provider, rates in SANDBOX_RATES.items()
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


def sandbox_rates_for(*, provider: str) -> Optional[SandboxRates]:
    """The per-hour resource rates for one sandbox provider, or None when unpriced."""
    return SANDBOX_RATES.get(provider)
