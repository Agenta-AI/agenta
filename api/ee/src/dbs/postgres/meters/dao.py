from typing import Callable, Tuple, Optional

from sqlalchemy import update
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import func, literal


from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.shared.engine import engine

from ee.src.core.entitlements.types import Quota
from ee.src.core.meters.types import MeterDTO
from ee.src.core.subscriptions.types import SubscriptionDTO
from ee.src.core.meters.interfaces import MetersDAOInterface
from ee.src.dbs.postgres.meters.dbes import MeterDBE
from ee.src.utils.billing import compute_billing_period


log = get_module_logger(__name__)


class MetersDAO(MetersDAOInterface):
    def __init__(self):
        pass

    async def dump(
        self,
        limit: Optional[int] = None,
    ) -> list[MeterDTO]:
        log.info(f"[report] [dump] Starting (limit={limit or 'none'})")

        async with engine.core_session() as session:
            try:
                stmt = (
                    select(MeterDBE)
                    .filter(MeterDBE.synced != MeterDBE.value)
                    .options(joinedload(MeterDBE.subscription))
                    .order_by(
                        MeterDBE.organization_id,
                        MeterDBE.key,
                        MeterDBE.year,
                        MeterDBE.month,
                    )
                )

                if limit:
                    stmt = stmt.limit(limit)

                result = await session.execute(stmt)
                meters = result.scalars().all()

                log.info(f"[report] [dump] Found {len(meters)} unsynced meters")

                dto_list = []
                for meter in meters:
                    try:
                        subscription_dto = None
                        if meter.subscription:
                            subscription_dto = SubscriptionDTO(
                                organization_id=meter.subscription.organization_id,
                                customer_id=meter.subscription.customer_id,
                                subscription_id=meter.subscription.subscription_id,
                                plan=meter.subscription.plan,
                                active=meter.subscription.active,
                                anchor=meter.subscription.anchor,
                            )

                        meter_dto = MeterDTO(
                            organization_id=meter.organization_id,
                            year=meter.year,
                            month=meter.month,
                            value=meter.value,
                            key=meter.key,
                            synced=meter.synced,
                            subscription=subscription_dto,
                        )
                        dto_list.append(meter_dto)

                    except Exception:
                        log.error(
                            "[report] [dump] Error converting meter to DTO",
                            exc_info=True,
                        )
                        continue

                log.info(f"[report] [dump] Converted {len(dto_list)} meters to DTOs")
                return dto_list

            except Exception:
                log.error("[report] [dump] Error executing query", exc_info=True)
                raise

    async def bump(
        self,
        meters: list[MeterDTO],
    ) -> None:
        if not meters:
            return

        log.info(f"[report] [bump] Starting for {len(meters)} meters")
        chunk_size = 25

        sorted_meters = sorted(
            meters,
            key=lambda m: (m.organization_id, m.key, m.year, m.month),
        )
        total_attempted = len(sorted_meters)
        unique_rows = len(
            {(m.organization_id, m.key, m.year, m.month) for m in sorted_meters}
        )

        if unique_rows != total_attempted:
            log.warn(
                f"[report] [bump] Duplicate meter rows in batch: attempted={total_attempted} unique={unique_rows}"
            )

        updated_count = 0
        missing_count = 0
        missing_samples: list[str] = []
        failed_count = 0
        failed_samples: list[str] = []

        total_chunks = (len(sorted_meters) + chunk_size - 1) // chunk_size
        for idx in range(0, len(sorted_meters), chunk_size):
            chunk = sorted_meters[idx : idx + chunk_size]
            chunk_no = idx // chunk_size + 1
            log.info(
                f"[report] [bump] Chunk {chunk_no}/{total_chunks}: size={len(chunk)}"
            )
            try:
                log.info(f"[report] [bump] Chunk {chunk_no}/{total_chunks}: committing")
                (
                    chunk_updated,
                    chunk_missing,
                    chunk_missing_samples,
                ) = await self._bump_commit_chunk(
                    meters=chunk,
                )
                updated_count += chunk_updated
                missing_count += chunk_missing
                for sample in chunk_missing_samples:
                    if len(missing_samples) < 5:
                        missing_samples.append(sample)
                log.info(
                    f"[report] [bump] Chunk {chunk_no}/{total_chunks}: committed "
                    f"updated={chunk_updated} missing={chunk_missing}"
                )
            except Exception:
                log.error(
                    f"[report] [bump] ❌ Chunk {chunk_no}/{total_chunks} commit failed, retrying row-by-row",
                    exc_info=True,
                )
                for meter in chunk:
                    meter_id = f"{meter.organization_id}/{meter.key}:{meter.year}-{meter.month}"
                    try:
                        (
                            row_updated,
                            row_missing,
                            row_missing_samples,
                        ) = await self._bump_commit_chunk(
                            meters=[meter],
                        )
                        updated_count += row_updated
                        missing_count += row_missing
                        for sample in row_missing_samples:
                            if len(missing_samples) < 5:
                                missing_samples.append(sample)
                    except Exception:
                        failed_count += 1
                        if len(failed_samples) < 5:
                            failed_samples.append(meter_id)
                        log.error(
                            f"[report] [bump] ❌ Row fallback failed for {meter_id} synced={meter.synced} value={meter.value}",
                            exc_info=True,
                        )

        if missing_count > 0:
            log.warn(
                f"[report] [bump] Missing rows after commits: "
                f"attempted={total_attempted} updated={updated_count} missing={missing_count} "
                f"samples={missing_samples}"
            )

        log.info(
            f"[report] [bump] ✅ Bump summary: attempted={total_attempted} "
            f"updated={updated_count} missing={missing_count} failed={failed_count}"
        )

        if failed_count > 0:
            raise RuntimeError(
                "[report] [bump] unresolved failures after row fallback: "
                f"failed={failed_count} samples={failed_samples}"
            )

    async def _bump_commit_chunk(
        self,
        *,
        meters: list[MeterDTO],
    ) -> tuple[int, int, list[str]]:
        updated_count = 0
        missing_count = 0
        missing_samples: list[str] = []

        async with engine.core_session() as session:
            for meter in meters:
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

                result = await session.execute(stmt)
                rowcount = int(result.rowcount or 0)

                if rowcount == 0:
                    missing_count += 1
                    if len(missing_samples) < 5:
                        missing_samples.append(
                            f"{meter.organization_id}/{meter.key}:{meter.year}-{meter.month}"
                        )
                    log.warn(
                        f"[report] [bump] No rows updated for "
                        f"org={meter.organization_id} key={meter.key} "
                        f"period={meter.year}-{meter.month} synced={meter.synced} value={meter.value}"
                    )
                else:
                    updated_count += rowcount

            try:
                await session.commit()
            except Exception:
                await session.rollback()
                raise

        return updated_count, missing_count, missing_samples

    async def fetch(
        self,
        *,
        organization_id: str,
        key: Optional[str] = None,
        year: Optional[int] = None,
        month: Optional[int] = None,
    ) -> list[MeterDTO]:
        async with engine.core_session() as session:
            stmt = select(MeterDBE).filter_by(
                organization_id=organization_id,
            )  # NO RISK OF DEADLOCK

            # Apply optional filters for period-aware querying
            if key is not None:
                stmt = stmt.filter_by(key=key)
            if year is not None:
                stmt = stmt.filter_by(year=year)
            if month is not None:
                stmt = stmt.filter_by(month=month)

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
            year, month = compute_billing_period(anchor=anchor)
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
            year, month = compute_billing_period(anchor=anchor)
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

        # 4. Build SQL statement (atomic upsert with RETURNING)
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
                .returning(MeterDBE.value)
            )

            result = await session.execute(stmt)
            row = result.fetchone()
            await session.commit()

        # 5. Check if update was applied (strict mode)
        allowed = row is not None
        actual_value = row[0] if row else desired_value

        return (
            allowed,
            MeterDTO(
                **meter.model_dump(exclude={"value", "synced"}),
                value=actual_value,
                synced=0,
            ),
            lambda: None,  # rollback not needed; no state was touched otherwise
        )
