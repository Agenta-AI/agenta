"""Port for gateway measurement persistence. Implemented by
the Postgres adapter in `ee.src.dbs.postgres.measurements`.
"""

from typing import Optional

from ee.src.core.measurements.dtos import ChargeDecision, PersistedMeasurement
from ee.src.core.wallets.contracts import MeasurementCommandV1


class MeasurementsDAOInterface:
    async def fetch_measurement(
        self,
        *,
        command: MeasurementCommandV1,
    ) -> Optional[PersistedMeasurement]:
        """The stored measurement for `command.measurement_id`, with its stored charge
        decision, or None when it has not been stored. Raises `MeasurementConflictError`
        when the stored measurement's content differs from `command`'s."""
        raise NotImplementedError

    async def insert_measurement(
        self,
        *,
        command: MeasurementCommandV1,
        charge: Optional[ChargeDecision],
    ) -> PersistedMeasurement:
        """Idempotently insert one measurement, all of its component value rows, and its
        charge decision in a single tracing transaction, keyed by
        `command.measurement_id`.

        Safe to call more than once with the same `measurement_id` (stream redelivery,
        or two workers racing on one message): an identical repeat neither raises nor
        writes, and returns the STORED decision rather than `charge`. A repeat whose
        content differs from the stored measurement writes nothing and raises
        `MeasurementConflictError`: the stored measurement never changes.
        """
        raise NotImplementedError
