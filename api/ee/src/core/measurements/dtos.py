"""Domain DTOs for the gateway measurement persistence path.

Wire DTOs (`MeasurementCommandV1`, `MeasurementComponentV1`) live in
`ee.src.core.wallets.contracts` — these are the persisted-row result types, kept
separate so the DAO layer never leaks SQLAlchemy entities to its callers.
"""

from uuid import UUID

from pydantic import BaseModel


class PersistedMeasurement(BaseModel):
    """Result of one idempotent measurement insert."""

    id: UUID
    measurement_id: str
    # False when `measurement_id` already existed with identical content (a
    # replayed/redelivered message); nothing was written.
    created: bool
