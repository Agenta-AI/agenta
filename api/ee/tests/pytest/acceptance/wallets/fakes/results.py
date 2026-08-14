"""Shared result shape for the wallet-owned fakes.

`core/gateways/*/providers/fake/` is a different, concurrent wave's path (a
one-owner-per-file rule) — these fakes are deliberately local to wallet
acceptance support, not a gateway provider implementation.
"""

from typing import Any

from pydantic import BaseModel

from ee.src.core.wallets.contracts import MeasurementCommandV1


class FakeGatewayResult(BaseModel):
    """One deterministic fake managed result, plus the one measurement command
    published for it.

    `published` mirrors the publisher's return value: the fake result itself
    is unaffected by a publish failure — a failed initial `XADD` means no
    persisted measurement and no debit, never a changed caller-visible result.
    """

    managed_result: Any
    measurement_command: MeasurementCommandV1
    published: bool
