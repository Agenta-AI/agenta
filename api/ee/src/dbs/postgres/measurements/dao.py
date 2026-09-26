"""Postgres (tracing DB) adapter for gateway measurement persistence.

Uses `AnalyticsEngine` (tracing DB), never `TransactionsEngine` (core DB) — see
`docs/design/wallets-research/v1/entities.md` "Candidate store placement".
"""

import uuid_utils.compat as uuid
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from oss.src.dbs.postgres.shared.engine import AnalyticsEngine, get_analytics_engine

from ee.src.core.measurements.dtos import PersistedMeasurement
from ee.src.core.measurements.interfaces import MeasurementsDAOInterface
from ee.src.core.wallets.contracts import MeasurementCommandV1
from ee.src.dbs.postgres.measurements.dbes import MeasurementDBE, MeasurementValueDBE
from ee.src.dbs.postgres.measurements.mappings import (
    measurement_command_to_row,
    measurement_components_to_rows,
)


class MeasurementsDAO(MeasurementsDAOInterface):
    def __init__(self, engine: AnalyticsEngine = None):
        if engine is None:
            engine = get_analytics_engine()
        self.engine = engine

    async def insert_measurement(
        self,
        *,
        command: MeasurementCommandV1,
    ) -> PersistedMeasurement:
        measurement_row_id = uuid.uuid7()

        async with self.engine.session() as session:
            parent_stmt = (
                insert(MeasurementDBE)
                .values(
                    measurement_command_to_row(
                        measurement_row_id=measurement_row_id, command=command
                    )
                )
                .on_conflict_do_nothing(index_elements=["measurement_id"])
                .returning(MeasurementDBE.id)
            )
            inserted = (await session.execute(parent_stmt)).first()

            if inserted is not None:
                created = True
                row_id = inserted[0]
            else:
                # Already present — a redelivered/replayed message. Same
                # transaction, no separate round trip outside this unit of work.
                created = False
                existing = await session.execute(
                    select(MeasurementDBE.id).where(
                        MeasurementDBE.measurement_id == command.measurement_id
                    )
                )
                row_id = existing.scalar_one()

            if command.components:
                value_rows = measurement_components_to_rows(
                    measurement_row_id=row_id, components=command.components
                )
                values_stmt = (
                    insert(MeasurementValueDBE)
                    .values(value_rows)
                    .on_conflict_do_nothing(index_elements=["measurement_id", "key"])
                )
                await session.execute(values_stmt)

            await session.commit()

        return PersistedMeasurement(
            id=row_id,
            measurement_id=command.measurement_id,
            created=created,
        )
