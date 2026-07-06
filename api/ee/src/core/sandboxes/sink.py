"""record_usage_credits() -- wallet debit sink for sandbox resource-second events.

Called by `SandboxMeteringService.record_usage()` with the raw resource
seconds for one usage event (the raw *_seconds dimensions themselves are
cost-explainer data, not billing meters, so they are not adjusted here).
Per event it:

  1. Computes per-dimension *_debits from the raw seconds via `to_credits()`.
  2. Adjusts each per-dimension *_debits meter.
  3. Sums per-dimension debits into sandbox_debits and adjusts that meter.
  4. Adds the same sandbox_debits total into wallet_debits, the cross-family
     grand total (LLM_DEBITS + SANDBOX_DEBITS + GATEWAY_DEBITS).

Credit deltas are stored as millicredits (credits x 1000, truncated) to
preserve sub-credit precision without changing the int-typed MeterDTO.delta
field. Stripe's per-millicredit price accounts for the x1000 factor.

All adjustments are org-scoped. Gate: is_ee() (caller gates on provider.enabled).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee

from ee.src.core.access.entitlements.types import Counter
from ee.src.core.access.entitlements.service import check_entitlements
from ee.src.core.meters.types import MeterScope
from ee.src.core.sandboxes.credits import Dimension, to_credits


log = get_module_logger(__name__)

# Millicredits scale factor: credits x 1000 stored as int in MeterDTO.delta.
_MILLICREDITS = Decimal("1000")


async def record_usage_credits(
    *,
    provider: str,
    organization_id: UUID,
    #
    cpu_seconds: Decimal = Decimal("0"),
    ram_seconds: Decimal = Decimal("0"),
    ssd_seconds: Decimal = Decimal("0"),
    gpu_seconds: Optional[Decimal] = None,
) -> None:
    """Record per-dimension + sandbox + wallet debits for one usage event.

    Writes SANDBOX_{CPU,RAM,SSD,GPU}_DEBITS, SANDBOX_DEBITS, and accumulates
    the sandbox total into WALLET_DEBITS in one call. No-ops silently when
    is_ee() is False.

    Args:
        provider: Provider slug ("e2b", "daytona", "local", ...).
        organization_id: Org to meter under.
        cpu_seconds: vCPU-s consumed (Decimal >= 0).
        ram_seconds: GiB-s of RAM consumed (Decimal >= 0).
        ssd_seconds: GiB-s of disk consumed (Decimal >= 0).
        gpu_seconds: GPU-s consumed; None means provider has no GPU meter.
    """
    if not is_ee():
        return

    meter_scope = MeterScope(organization_id=organization_id)

    dimension_pairs: list[tuple[Counter, Dimension, Decimal]] = [
        (Counter.SANDBOX_CPU_CORE_DEBITS, Dimension.CPU, cpu_seconds),
        (Counter.SANDBOX_RAM_GIBI_DEBITS, Dimension.RAM, ram_seconds),
        (Counter.SANDBOX_SSD_GIBI_DEBITS, Dimension.SSD, ssd_seconds),
    ]
    if gpu_seconds is not None:
        dimension_pairs.append(
            (Counter.SANDBOX_GPU_CORE_DEBITS, Dimension.GPU, gpu_seconds)
        )

    # The total is the sum of the per-dimension millicredits actually written,
    # not a re-truncation of the exact credit sum. This keeps SANDBOX_DEBITS
    # exactly reconcilable against the per-dimension breakdown meters (a dim that
    # rounds to 0 millicredits contributes 0 to both the meter and the total).
    total_millicredits = 0
    for counter, dimension, units in dimension_pairs:
        credits = to_credits(provider=provider, dimension=dimension, raw_units=units)
        # Store as millicredits to preserve sub-credit precision in the int field.
        millicredits = int(credits * _MILLICREDITS)
        if millicredits <= 0:
            continue
        total_millicredits += millicredits
        try:
            await check_entitlements(
                key=counter,
                delta=millicredits,
                cache=False,
                scope=meter_scope,
            )
        except Exception:  # pylint: disable=broad-exception-caught
            log.warning(
                "[sandboxes] failed to record %s for org=%s",
                counter.value,
                organization_id,
                exc_info=True,
            )

    if total_millicredits <= 0:
        return

    try:
        await check_entitlements(
            key=Counter.SANDBOX_DEBITS,
            delta=total_millicredits,
            cache=False,
            scope=meter_scope,
        )
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning(
            "[sandboxes] failed to record sandbox_debits for org=%s",
            organization_id,
            exc_info=True,
        )

    try:
        await check_entitlements(
            key=Counter.WALLET_DEBITS,
            delta=total_millicredits,
            cache=False,
            scope=meter_scope,
        )
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning(
            "[sandboxes] failed to record wallet_debits for org=%s",
            organization_id,
            exc_info=True,
        )
