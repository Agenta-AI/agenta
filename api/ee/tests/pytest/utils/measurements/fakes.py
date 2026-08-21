"""In-memory test doubles for the measurement worker's ports.

Pure Python, no Redis/Postgres — for unit tests of worker/DAO-contract
behavior. The real Postgres adapter (`ee.src.dbs.postgres.measurements.dao`)
is exercised separately by the integration suite.
"""

from typing import Dict, List, Optional, Tuple
from uuid import UUID
import uuid_utils.compat as uuid

from ee.src.core.measurements.dtos import PersistedMeasurement
from ee.src.core.measurements.interfaces import (
    MeasurementsDAOInterface,
    OrganizationResolverInterface,
)
from ee.src.core.wallets.contracts import DebitCommandV1, MeasurementCommandV1


class InMemoryMeasurementsDAO(MeasurementsDAOInterface):
    """Mirrors the real DAO's idempotency contract: `UNIQUE (measurement_id)`
    on the parent, `UNIQUE (measurement_id, key)` on values, one call inserts
    parent + all children together (atomicity is a property of the call
    signature, not of a transaction this fake can offer)."""

    def __init__(self) -> None:
        self.rows: Dict[str, UUID] = {}  # measurement_id -> row id
        self.values: Dict[UUID, Dict[str, Tuple[int, Optional[int]]]] = {}
        self.insert_calls: List[MeasurementCommandV1] = []

    async def insert_measurement(
        self,
        *,
        command: MeasurementCommandV1,
    ) -> PersistedMeasurement:
        self.insert_calls.append(command)

        existing_id = self.rows.get(command.measurement_id)
        if existing_id is not None:
            return PersistedMeasurement(
                id=existing_id, measurement_id=command.measurement_id, created=False
            )

        row_id = uuid.uuid7()
        self.rows[command.measurement_id] = row_id
        value_rows = self.values.setdefault(row_id, {})
        for component in command.components:
            # UNIQUE (measurement_id, key): first write per key wins, like ON
            # CONFLICT DO NOTHING in the real adapter.
            value_rows.setdefault(component.key, (component.value, component.cost_musd))

        return PersistedMeasurement(
            id=row_id, measurement_id=command.measurement_id, created=True
        )


class InMemoryOrganizationResolver(OrganizationResolverInterface):
    def __init__(self, mapping: Optional[Dict[UUID, UUID]] = None) -> None:
        self.mapping = mapping or {}

    async def resolve_organization_id(
        self,
        *,
        project_id: UUID,
    ) -> Optional[UUID]:
        return self.mapping.get(project_id)


class InMemoryDebitPublisher:
    """Captures every publish attempt; `fail_next` simulates one transient
    Redis failure (the worker must leave the message pending, not ACK it)."""

    def __init__(self) -> None:
        self.published: List[DebitCommandV1] = []
        self.fail_next: bool = False

    async def publish(self, command: DebitCommandV1) -> bool:
        if self.fail_next:
            self.fail_next = False
            return False
        self.published.append(command)
        return True


class InMemoryMeasurementPublisher:
    """Captures every publish attempt for the fakes' producer-side tests."""

    def __init__(self) -> None:
        self.published: List[MeasurementCommandV1] = []
        self.fail_next: bool = False

    async def publish(self, command: MeasurementCommandV1) -> bool:
        if self.fail_next:
            self.fail_next = False
            return False
        self.published.append(command)
        return True
