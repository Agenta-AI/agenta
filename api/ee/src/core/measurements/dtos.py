"""Domain DTOs for the gateway measurement persistence path.

Wire DTOs (`MeasurementCommandV1`, `MeasurementComponentV1`) live in
`ee.src.core.wallets.contracts` — these are the persisted-row result types, kept
separate so the DAO layer never leaks SQLAlchemy entities to its callers.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class ChargeDecision(BaseModel):
    """What the worker decided a measurement costs, stored with the measurement in the
    same transaction so that every redelivery publishes this decision and never a
    recomputed one: not after a rate change, and not when the organization lookup is
    down. `created_at` is the debit's own timestamp, stored so a replayed debit envelope
    is identical to the first."""

    amount_musd: int
    pricing_version: str
    organization_id: UUID
    created_at: datetime


class PersistedMeasurement(BaseModel):
    """Result of one idempotent measurement insert or lookup."""

    id: UUID
    measurement_id: str
    # False when `measurement_id` already existed with identical content (a
    # replayed/redelivered message); nothing was written.
    created: bool
    # The stored decision, which on a replay or a lost insert race is the one that was
    # committed first, not the caller's. None: the measurement is not charged.
    charge: Optional[ChargeDecision] = None
