from typing import Callable, Tuple, Optional
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import update
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload
from sqlalchemy import case, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import func, literal


from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.shared.engine import engine

from ee.src.core.entitlements.types import Quota
from ee.src.core.meters.types import MeterDTO
from ee.src.core.subscriptions.types import SubscriptionDTO
from ee.src.core.meters.interfaces import MetersDAOInterface
from ee.src.dbs.postgres.meters.dbes import MeterDBE


log = get_module_logger(__name__)


class MetersDAO(MetersDAOInterface):
    def __init__(self):
        pass

    async def dump(self) -> list[MeterDTO]:
        async with engine.core_session() as session:
            stmt = (
                select(MeterDBE)
                .filter(MeterDBE.synced != MeterDBE.value)
                .options(joinedload(MeterDBE.subscription))
            )  # NO RISK OF DEADLOCK

            result = await session.execute(stmt)
            meters = result.scalars().all()

            return [
                MeterDTO(
                    organization_id=meter.organization_id,
                    year=meter.year,
                    month=meter.month,
                    value=meter.value,
                    key=meter.key,
                    synced=meter.synced,
                    subscription=(
                        SubscriptionDTO(
                            organization_id=meter.subscription.organization_id,
                            customer_id=meter.subscription.customer_id,
                            subscription_id=meter.subscription.subscription_id,
                            plan=meter.subscription.plan,
                            active=meter.subscription.active,
                            anchor=meter.subscription.anchor,
                        )
                        if meter.subscription
                        else None
                    ),
                )
                for meter in meters
            ]

    async def bump(
        self,
        meters: list[MeterDTO],
    ) -> None:
        if not meters:
            return

        # Sort for consistent lock acquisition
        sorted_meters = sorted(
            meters,
            key=lambda m: (
                m.organization_id,
                m.key,
                m.year,
                m.month,
            ),
        )

        async with engine.core_session() as session:
            for meter in sorted_meters:
                stmt = (
                    update(MeterDBE)
                    .where(
                        MeterDBE.organization_id == meter.organization_id,
                        MeterDBE.key == meter.key,
                        MeterDBE.year == meter.year,
                        MeterDBE.month == meter.month,
                    )
                    .values(synced=meter.synced)
                )

                await session.execute(stmt)

            await session.commit()

    async def fetch(
        self,
        *,
        organization_id: str,
    ) -> list[MeterDTO]:
        async with engine.core_session() as session:
            stmt = select(MeterDBE).filter_by(
                organization_id=organization_id,
            )  # NO RISK OF DEADLOCK

            result = await session.execute(stmt)
            meters = result.scalars().all()

            return [
                MeterDTO(
                    organization_id=meter.organization_id,
                    key=meter.key,
                    year=meter.year,
                    month=meter.month,
                    value=meter.value,
                    synced=meter.synced,
                )
                for meter in meters
            ]

    async def check(
        self,
        *,
        meter: MeterDTO,
        quota: Quota,
        anchor: Optional[int] = None,
    ) -> Tuple[bool, MeterDTO]:
        if quota.monthly:
            now = datetime.now(timezone.utc)

            if not anchor or now.day < anchor:
                year, month = now.year, now.month
            else:
                year = now.year + now.month // 12
                month = ((now.month + 1) % 12) or 12

            meter.year, meter.month = year, month

        async with engine.core_session() as session:
            stmt = select(MeterDBE).filter_by(
                organization_id=meter.organization_id,
                key=meter.key,
                year=meter.year,
                month=meter.month,
            )  # NO RISK OF DEADLOCK

            result = await session.execute(stmt)
            meter_record = result.scalar_one_or_none()

            current_value = meter_record.value if meter_record else 0

            adjusted_value = current_value + (meter.delta or 0)
            adjusted_value = adjusted_value if adjusted_value >= 0 else 0

            if quota.limit is None:
                allowed = True
            else:
                allowed = adjusted_value <= quota.limit

            return (
                allowed,
                MeterDTO(
                    **meter.model_dump(exclude={"value", "synced"}),
                    value=current_value,
                    synced=meter_record.synced if meter_record else 0,
                ),
            )

    async def adjust(
        self,
        *,
        meter: MeterDTO,
        quota: Quota,
        anchor: Optional[int] = None,
    ) -> Tuple[bool, MeterDTO, Callable]:
        # 1. Normalize meter.year/month if monthly quota
        if quota.monthly:
            now = datetime.now(timezone.utc)

            if not anchor or now.day < anchor:
                year, month = now.year, now.month
            else:
                year = now.year + now.month // 12
                month = ((now.month + 1) % 12) or 12

            meter.year, meter.month = year, month

        # 2. Calculate proposed value (starting from 0)
        desired_value = meter.value if meter.value is not None else (meter.delta or 0)
        desired_value = max(desired_value, 0)

        # 3. Block insert if quota exceeded
        if quota.limit is not None and desired_value > quota.limit:
            return (
                False,
                MeterDTO(
                    **meter.model_dump(exclude={"value", "synced"}),
                    value=0,
                    synced=0,
                ),
                lambda: None,
            )

        where_clauses = []

        # Handle unlimited quota case
        if quota.limit is None:
            where_clauses.append(literal(True))

        # Strict mode: use the adjusted value check
        elif quota.strict:
            if meter.delta is not None:
                adjusted_expr = func.greatest(MeterDBE.value + meter.delta, 0)
            elif meter.value is not None:
                adjusted_expr = func.greatest(meter.value, 0)
            else:
                raise ValueError("Either delta or value must be set")

            where_clauses.append(adjusted_expr <= quota.limit)

        # Soft mode: just compare current value
        else:
            where_clauses.append(MeterDBE.value <= quota.limit)

        # Now safely combine the conditions
        where = None
        for where_clause in where_clauses:
            if where is None:
                where = where_clause
            else:
                where = where | where_clause

        # 4. Build SQL statement (atomic upsert)
        async with engine.core_session() as session:
            stmt = (
                insert(MeterDBE)
                .values(
                    organization_id=meter.organization_id,
                    key=meter.key,
                    year=meter.year,
                    month=meter.month,
                    value=desired_value,
                    synced=0,
                )
                .on_conflict_do_update(
                    index_elements=[
                        MeterDBE.organization_id,
                        MeterDBE.key,
                        MeterDBE.year,
                        MeterDBE.month,
                    ],
                    set_={
                        "value": func.greatest(
                            (
                                (MeterDBE.value + meter.delta)
                                if meter.delta is not None
                                else meter.value
                            ),
                            0,
                        )
                    },
                    where=where,
                )
            )

            result = await session.execute(stmt)
            await session.commit()

        # 5. Check if update was applied (strict mode)
        allowed = result.rowcount > 0

        return (
            allowed,
            MeterDTO(
                **meter.model_dump(exclude={"value", "synced"}),
                value=desired_value,  # not technically accurate in soft mode, but good enough
                synced=0,
            ),
            lambda: None,  # rollback not needed; no state was touched otherwise
        )
