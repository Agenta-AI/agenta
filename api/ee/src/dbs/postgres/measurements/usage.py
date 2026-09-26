"""Tracing-DB read for the wallet usage view: the measurements a set of debits was priced
from, with their component values."""

from typing import Dict, Iterable

from sqlalchemy import select

from oss.src.dbs.postgres.shared.engine import AnalyticsEngine, get_analytics_engine

from ee.src.core.wallets.usage.dtos import MeasurementUsage
from ee.src.core.wallets.usage.interfaces import MeasurementUsageDAOInterface
from ee.src.dbs.postgres.measurements.dbes import MeasurementDBE, MeasurementValueDBE


class MeasurementUsageDAO(MeasurementUsageDAOInterface):
    def __init__(self, engine: AnalyticsEngine = None):
        self.engine = engine or get_analytics_engine()

    async def fetch_measurements(
        self, *, measurement_ids: Iterable[str]
    ) -> Dict[str, MeasurementUsage]:
        ids = list(measurement_ids)
        if not ids:
            return {}
        async with self.engine.session() as session:
            rows = (
                await session.execute(
                    select(MeasurementDBE).where(MeasurementDBE.measurement_id.in_(ids))
                )
            ).scalars()
            measurements = {row.id: row for row in rows}
            values = (
                await session.execute(
                    select(
                        MeasurementValueDBE.measurement_id,
                        MeasurementValueDBE.key,
                        MeasurementValueDBE.value,
                    ).where(MeasurementValueDBE.measurement_id.in_(list(measurements)))
                )
            ).all()

        components: Dict = {row_id: {} for row_id in measurements}
        for row_id, key, value in values:
            components[row_id][key] = value

        return {
            row.measurement_id: MeasurementUsage(
                measurement_id=row.measurement_id,
                project_id=row.project_id,
                user_id=row.user_id,
                agent_id=row.agent_id,
                references=(row.data or {}).get("references") or {},
                components=components[row_id],
                end_time=row.end_time,
            )
            for row_id, row in measurements.items()
        }
