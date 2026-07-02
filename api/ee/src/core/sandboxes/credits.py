"""Sandbox credit conversion: raw resource-seconds -> credits.

Credits are dimensionless billing units emitted to Stripe. Stripe multiplies by
the per-credit price for the plan at billing time -- no credit<->money math
lives here. Stored as millicredits (credits x 1000, truncated) so the
int-typed MeterDTO.delta field preserves sub-credit precision; Stripe's price
denominator accounts for the x1000 factor.

to_credits() is the single conversion function; pure, no I/O, Decimal
throughout. Dimension names mirror the locked sandbox meter key scheme
(CPU/RAM/SSD/GPU) -- see docs/designs/sandbox-metering/NAMING.md.
"""

from __future__ import annotations

from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, ConfigDict

from oss.src.utils.env import env


class Dimension(str, Enum):
    """Resource dimensions billed per second."""

    CPU = "cpu"  # vCPU-s
    RAM = "ram"  # GiB-s of RAM
    SSD = "ssd"  # GiB-s of disk
    GPU = "gpu"  # GPU-s


class ProviderRates(BaseModel):
    """Credits-per-unit rates for one provider across all dimensions.

    Each rate is credits per raw unit-second for that dimension.
    Stripe owns the credit->money price; these are dimensionless conversion
    rates.
    """

    # Reference: a standard 2vCPU/2GiB/10GiB machine for 1 minute is a useful
    # cross-check (informational only -- not a billing input).
    cpu: Decimal  # credits per vCPU-s  (e.g. 0.0014)
    ram: Decimal  # credits per GiB-s of RAM  (e.g. 0.00045)
    ssd: Decimal  # credits per GiB-s of disk  (e.g. 0.000003)
    gpu: Decimal  # credits per GPU-s; 0 = no GPU billing for this provider

    model_config = ConfigDict(extra="forbid")


# Default per-provider x per-dimension rate table.
# Informational cross-check: 2 vCPU x 60s x 0.0014 + 2 GiB x 60s x 0.00045
#   + 10 GiB x 60s x 0.000003 ~= 0.2232 credits/min per reference machine.
DEFAULT_PROVIDER_RATES: dict[str, ProviderRates] = {
    "e2b": ProviderRates(
        cpu=Decimal("0.0014"),  # vCPU-s -> credits
        ram=Decimal("0.00045"),  # GiB-s RAM -> credits
        ssd=Decimal("0.000003"),  # GiB-s disk -> credits
        gpu=Decimal("0"),  # E2B has no GPU meter
    ),
    "daytona": ProviderRates(
        cpu=Decimal("0.0014"),  # vCPU-s -> credits
        ram=Decimal("0.00045"),  # GiB-s RAM -> credits
        ssd=Decimal("0.000003"),  # GiB-s disk -> credits
        gpu=Decimal("0"),  # GPU rate: no default; set via env override
    ),
    "local": ProviderRates(
        cpu=Decimal("0"),  # zero-rated: local sandbox has no billing cost
        ram=Decimal("0"),
        ssd=Decimal("0"),
        gpu=Decimal("0"),
    ),
}

_RATES: dict[str, ProviderRates] | None = None


def _build_rates() -> dict[str, ProviderRates]:
    raw = env.sandbox.credit_rates
    if not raw:
        return dict(DEFAULT_PROVIDER_RATES)

    result: dict[str, ProviderRates] = dict(DEFAULT_PROVIDER_RATES)
    for provider, dims in raw.items():
        if not isinstance(dims, dict):
            continue
        base = DEFAULT_PROVIDER_RATES.get(str(provider).lower())
        base_data: dict[str, Decimal] = (
            base.model_dump()
            if base
            else {
                "cpu": Decimal("0"),
                "ram": Decimal("0"),
                "ssd": Decimal("0"),
                "gpu": Decimal("0"),
            }
        )
        for dim_key, rate_str in dims.items():
            if dim_key in base_data:
                try:
                    base_data[dim_key] = Decimal(str(rate_str))
                except Exception:  # pylint: disable=broad-exception-caught
                    pass
        try:
            result[str(provider).lower()] = ProviderRates(**base_data)
        except Exception:  # pylint: disable=broad-exception-caught
            pass
    return result


def _get_rates() -> dict[str, ProviderRates]:
    global _RATES
    if _RATES is None:
        _RATES = _build_rates()
    return _RATES


def to_credits(
    *,
    provider: str,
    dimension: Dimension | str,
    raw_units: Decimal,
) -> Decimal:
    """Convert raw resource-seconds to credits.

    Args:
        provider: Provider slug ("e2b", "daytona", "local", ...).
        dimension: Dimension enum or string ("cpu", "ram", "ssd", "gpu").
        raw_units: Raw resource-seconds as Decimal. Values <= 0 return 0.

    Returns:
        Credits as Decimal (>= 0). Returns 0 when provider/dimension has no
        rate.
    """
    if raw_units <= Decimal("0"):
        return Decimal("0")

    rates = _get_rates()
    provider_rates = rates.get(str(provider).lower())
    if provider_rates is None:
        return Decimal("0")

    dim_str = (
        dimension.value if isinstance(dimension, Dimension) else str(dimension).lower()
    )
    rate = getattr(provider_rates, dim_str, None)
    if rate is None:
        return Decimal("0")
    return raw_units * rate
