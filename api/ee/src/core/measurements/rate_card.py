"""Our price list for platform-funded (`builtin`) usage: gateway calls, sandbox time and
managed tool actions.

Integer micro-dollars throughout, per million tokens, per request, or per resource-hour. A price change is a
change to this file, reviewed and approved by product; nothing else sets a price.

The mock provider's token rates and the request rates are SYNTHETIC and are not approved
prices: the mock serves only behind `env.mock_gateways.enabled`. A real `builtin` provider
brings its own rows, with their source and date, as the `agenta` and sandbox rows do.
"""

from hashlib import sha256
from typing import Dict, Optional, Tuple

from orjson import OPT_SORT_KEYS, dumps
from pydantic import BaseModel, Field, model_validator

from ee.src.core.measurements.components import ACTION_CALLS, ACTION_RESULTS


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


class ActionRates(BaseModel):
    """Our price for one managed tool action: a price per billable unit, and for a count
    that varies per call, the most units one call is charged. The cap is required for a
    per-result price, because admission refuses a call its organization cannot pay at
    worst."""

    unit: str  # the component key priced
    musd_per_unit: int = Field(gt=0)
    max_units_per_call: Optional[int] = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _per_result_is_capped(self) -> "ActionRates":
        if self.unit == ACTION_RESULTS and self.max_units_per_call is None:
            raise ValueError("a per-result rate needs max_units_per_call")
        return self


_MOCK_RATES = TokenRates(
    input_musd_per_million=1_000_000,  # $1.00 / M
    cache_read_musd_per_million=100_000,  # $0.10 / M
    cache_write_musd_per_million=1_250_000,  # $1.25 / M
    output_musd_per_million=4_000_000,  # $4.00 / M
)

# Our models: Gemini on Agenta's Vertex AI account, at the CURRENT list price x 1.75.
# Source: cloud.google.com/vertex-ai/generative-ai/pricing, read 2026-10-02. Both models,
# global endpoint, "through December 31, 2026": $0.75 input, $0.075 cached input, $3.75
# output (response and reasoning) per million tokens; from January 1, 2027 Google doubles
# both, and these rows change with it. Vertex's implicit cache has no per-token write
# charge, so a write is priced as fresh input. The gateway calls the `global` location; a
# non-global location lists 10% higher and is not priced here.
_GEMINI_FLASH_RATES = TokenRates(
    input_musd_per_million=1_312_500,  # 750_000 x 1.75
    cache_read_musd_per_million=131_250,  # 75_000 x 1.75
    cache_write_musd_per_million=1_312_500,  # priced as input
    output_musd_per_million=6_562_500,  # 3_750_000 x 1.75
)

# Keyed by the gateway's own vocabulary: (provider, model) as the producer writes them
# into `resource_locator`.
TOKEN_RATES: Dict[Tuple[str, str], TokenRates] = {
    ("agenta", "google/gemini-3.7-flash"): _GEMINI_FLASH_RATES,
    ("agenta", "google/gemini-3.8-flash"): _GEMINI_FLASH_RATES,
    **{
        ("mock", model): _MOCK_RATES
        for model in ("mock/echo", "gpt-5.5", "claude-sonnet-5")
    },
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


# Keyed by managed action key. SYNTHETIC, like the token rates: both actions are mocks
# behind `env.mock_gateways.enabled`.
ACTION_RATES: Dict[str, ActionRates] = {
    # $0.02 per successful enrichment.
    "mock.enrich_person": ActionRates(unit=ACTION_CALLS, musd_per_unit=20_000),
    # $0.002 per company returned, at most ten charged per search.
    "mock.search_companies": ActionRates(
        unit=ACTION_RESULTS, musd_per_unit=2_000, max_units_per_call=10
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
        "actions": {
            action: rates.model_dump() for action, rates in ACTION_RATES.items()
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


def action_rates_for(*, action: str) -> Optional[ActionRates]:
    """The rates for one managed action, or None when the card does not price it."""
    return ACTION_RATES.get(action)
