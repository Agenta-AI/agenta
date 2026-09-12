"""Ports for gateway measurement persistence and org resolution. Implemented by
the Postgres adapters in `ee.src.dbs.postgres.measurements`.
"""

from typing import Optional
from uuid import UUID

from ee.src.core.measurements.dtos import PersistedMeasurement
from ee.src.core.wallets.contracts import MeasurementCommandV1


class MeasurementsDAOInterface:
    async def insert_measurement(
        self,
        *,
        command: MeasurementCommandV1,
    ) -> PersistedMeasurement:
        """Idempotently insert one measurement and all of its component value
        rows in a single tracing transaction, keyed by `command.measurement_id`.

        Safe to call more than once with the same `measurement_id` (stream
        redelivery): a repeat call neither raises nor duplicates rows.
        """
        raise NotImplementedError


class OrganizationResolverInterface:
    async def resolve_organization_id(
        self,
        *,
        project_id: UUID,
    ) -> Optional[UUID]:
        """Look up `project_id`'s owning organization in the core DB. Returns
        `None` when the project cannot be resolved."""
        raise NotImplementedError
