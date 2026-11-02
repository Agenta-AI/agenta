"""Postgres (tracing DB) adapter for gateway measurement persistence.

Uses `AnalyticsEngine` (tracing DB), never `TransactionsEngine` (core DB) — see
`docs/design/wallets-research/v1/entities.md` "Candidate store placement".
"""

from typing import Optional

import uuid_utils.compat as uuid
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from oss.src.dbs.postgres.shared.engine import AnalyticsEngine, get_analytics_engine

from ee.src.core.measurements.dtos import ChargeDecision, PersistedMeasurement
from ee.src.core.measurements.interfaces import MeasurementsDAOInterface
from ee.src.core.wallets.contracts import MeasurementCommandV1
from ee.src.core.wallets.errors import MeasurementConflictError
from ee.src.dbs.postgres.measurements.dbes import MeasurementDBE, MeasurementValueDBE
from ee.src.dbs.postgres.measurements.mappings import (
    charge_from_data,
    measurement_command_to_row,
    measurement_components_to_rows,
    measurement_fingerprint,
)


class MeasurementsDAO(MeasurementsDAOInterface):
    def __init__(self, engine: AnalyticsEngine = None):
        if engine is None:
            engine = get_analytics_engine()
        self.engine = engine

    async def fetch_measurement(
        self,
        *,
        command: MeasurementCommandV1,
    ) -> Optional[PersistedMeasurement]:
        async with self.engine.session() as session:
            return await self._stored(session, command=command)

    async def insert_measurement(
        self,
        *,
        command: MeasurementCommandV1,
        charge: Optional[ChargeDecision],
    ) -> PersistedMeasurement:
        measurement_row_id = uuid.uuid7()
        row = measurement_command_to_row(
            measurement_row_id=measurement_row_id, command=command, charge=charge
        )

        async with self.engine.session() as session:
            parent_stmt = (
                insert(MeasurementDBE)
                .values(row)
                .on_conflict_do_nothing(index_elements=["measurement_id"])
                .returning(MeasurementDBE.id)
            )
            inserted = (await session.execute(parent_stmt)).first()

            if inserted is None:
                # Already present, possibly committed by a racing worker a moment ago
                # (the conflicting insert waits for it). Its decision is the one that
                # stands.
                return await self._stored(session, command=command)

            if command.components:
                await session.execute(
                    insert(MeasurementValueDBE).values(
                        measurement_components_to_rows(
                            measurement_row_id=measurement_row_id,
                            components=command.components,
                        )
                    )
                )

            await session.commit()

        return PersistedMeasurement(
            id=measurement_row_id,
            measurement_id=command.measurement_id,
            created=True,
            charge=charge,
        )

    @staticmethod
    async def _stored(
        session, *, command: MeasurementCommandV1
    ) -> Optional[PersistedMeasurement]:
        # The stored measurement is immutable: an identical replay confirms it, anything
        # else is a conflict and is never priced.
        found = (
            await session.execute(
                select(MeasurementDBE.id, MeasurementDBE.data).where(
                    MeasurementDBE.measurement_id == command.measurement_id
                )
            )
        ).first()
        if found is None:
            return None
        row_id, data = found
        if (data or {}).get("fingerprint") != measurement_fingerprint(command):
            raise MeasurementConflictError(measurement_id=command.measurement_id)
        return PersistedMeasurement(
            id=row_id,
            measurement_id=command.measurement_id,
            created=False,
            charge=charge_from_data(data),
        )
