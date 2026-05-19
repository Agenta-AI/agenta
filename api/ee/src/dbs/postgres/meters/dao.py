from typing import Callable, Tuple, Optional

from sqlalchemy import update
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import func, literal


from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.shared.engine import engine

from ee.src.core.entitlements.types import Quota
from ee.src.core.meters.types import MeterDTO, MeterScope, MeterPeriod, Meters
from ee.src.core.subscriptions.types import SubscriptionDTO
from ee.src.core.meters.interfaces import MetersDAOInterface
from ee.src.dbs.postgres.meters.dbes import MeterDBE
from ee.src.utils.entitlements import period_from


log = get_module_logger(__name__)


def _dbe_to_dto(meter: MeterDBE) -> MeterDTO:
    subscription_dto = None
    if getattr(meter, "subscription", None):
        subscription_dto = SubscriptionDTO(
            organization_id=meter.subscription.organization_id,
            customer_id=meter.subscription.customer_id,
            subscription_id=meter.subscription.subscription_id,
            plan=meter.subscription.plan,
            active=meter.subscription.active,
            anchor=meter.subscription.anchor,
        )

    return MeterDTO(
        organization_id=meter.organization_id,
        workspace_id=meter.workspace_id,
        project_id=meter.project_id,
        user_id=meter.user_id,
        #
        year=meter.year,
        month=meter.month,
        day=meter.day,
        #
        key=meter.key,
        value=meter.value,
        synced=meter.synced,
        meter_id=meter.meter_id,
        #
        subscription=subscription_dto,
    )


def _normalize_period_on_meter(
    meter: MeterDTO,
    quota: Quota,
    anchor: Optional[int],
) -> MeterDTO:
    """If the quota has a period AND the meter has no period set, snap
    (year, month, day) to the current bucket.

    Trusting a pre-populated period lets callers (most notably
    `check_entitlements` with an explicit `period=` kwarg, and future
    backdated-adjustment callers) pass an explicit bucket through to the
    DAO without the normalizer silently rewriting it to the current
    bucket — which would create a mismatch between the cache key (built
    on the caller's period) and the row actually upserted.
    """

    if quota.period is None:
        return meter

    if meter.year is not None or meter.month is not None or meter.day is not None:
        return meter

    period = period_from(period=quota.period, anchor=anchor)

    return meter.with_period(year=period.year, month=period.month, day=period.day)


def _format_meter_for_log(meter: MeterDTO) -> str:
    """Stable one-line meter description for logs and failure samples."""
    return (
        f"meter_id={meter.meter_id}"
        f"/{meter.organization_id}-{meter.workspace_id}-{meter.project_id}-{meter.user_id}"
        f":{meter.year}-{meter.month}-{meter.day}"
        f":{meter.key}={meter.value}|synced={meter.synced}"
    )


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
                        MeterDBE.workspace_id,
                        MeterDBE.project_id,
                        MeterDBE.user_id,
                        MeterDBE.key,
                        MeterDBE.year,
                        MeterDBE.month,
                        MeterDBE.day,
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
                        dto_list.append(_dbe_to_dto(meter))
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
            key=lambda m: str(m.meter_id),
        )
        total_attempted = len(sorted_meters)
        unique_rows = len({m.meter_id for m in sorted_meters})

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
                    this_meter = _format_meter_for_log(meter)
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
                            failed_samples.append(this_meter)
                        log.error(
                            f"[report] [bump] ❌ Row fallback failed for {this_meter}",
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
                    .where(MeterDBE.meter_id == meter.meter_id)
                    .values(synced=meter.synced)
                )

                result = await session.execute(stmt)
                rowcount = int(result.rowcount or 0)

                if rowcount == 0:
                    missing_count += 1
                    this_meter = _format_meter_for_log(meter)
                    if len(missing_samples) < 5:
                        missing_samples.append(this_meter)

                    log.warn(
                        f"[report] [bump] ❌ No rows updated for {this_meter}",
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
        scope: Optional[MeterScope] = None,
        key: Optional[Meters] = None,
        period: Optional[MeterPeriod] = None,
    ) -> list[MeterDTO]:
        """Fetch meter rows matching the given filters.

        Scope: `scope=None` and `MeterScope()` (all dims unset) both skip
        the scope filter — admin/rollup escape. Any other `MeterScope`
        binds every scope dim uniformly (`None` → `IS NULL`).

        Period: `period=None` skips the period filter; `MeterPeriod()`
        pins lifetime/gauge-sentinel rows (`year/month/day IS NULL`). Any
        other `MeterPeriod` binds every period dim uniformly.
        """
        async with engine.core_session() as session:
            stmt = select(MeterDBE).options(
                joinedload(MeterDBE.subscription)
            )  # NO RISK OF DEADLOCK

            if scope is not None and any(
                dim is not None
                for dim in (
                    scope.organization_id,
                    scope.workspace_id,
                    scope.project_id,
                    scope.user_id,
                )
            ):
                stmt = stmt.filter_by(organization_id=scope.organization_id)
                stmt = stmt.filter_by(workspace_id=scope.workspace_id)
                stmt = stmt.filter_by(project_id=scope.project_id)
                stmt = stmt.filter_by(user_id=scope.user_id)

            if key is not None:
                stmt = stmt.filter_by(key=key)

            if period is not None:
                stmt = stmt.filter_by(year=period.year)
                stmt = stmt.filter_by(month=period.month)
                stmt = stmt.filter_by(day=period.day)

            result = await session.execute(stmt)
            meters = result.scalars().all()

            return [_dbe_to_dto(meter) for meter in meters]

    async def check(
        self,
        *,
        meter: MeterDTO,
        quota: Quota,
        anchor: Optional[int] = None,
    ) -> Tuple[bool, MeterDTO]:
        meter = _normalize_period_on_meter(meter, quota, anchor)

        async with engine.core_session() as session:
            stmt = select(MeterDBE).filter_by(
                meter_id=meter.meter_id,
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
        # 1. Normalize meter period to the current bucket if the quota is periodic.
        meter = _normalize_period_on_meter(meter, quota, anchor)

        # 2. Compute the value to seed on insert (used by the upsert
        #    statement below and as the fallback when the predicate
        #    denies). Clamp to 0 to match the SQL-side `greatest(..., 0)`.
        desired_value = meter.value if meter.value is not None else (meter.delta or 0)
        desired_value = max(desired_value, 0)

        # 3. Python-side fast-path: reject any predictable self-overshoot
        #    (a write that, on its own, would push the meter past the limit
        #    regardless of the row's current state). Absolute writes use
        #    meter.value; delta writes use meter.delta. Concurrent races
        #    that turn a permissible write into an overshoot are caught by
        #    the SQL predicate below, not here.
        if quota.limit is not None:
            if meter.value is not None and meter.value > quota.limit:
                return (
                    False,
                    MeterDTO(
                        **meter.model_dump(exclude={"value", "synced"}),
                        value=0,
                        synced=0,
                    ),
                    lambda: None,
                )
            if (
                meter.value is None
                and meter.delta is not None
                and meter.delta > quota.limit
            ):
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

        # Strict mode: block any predictable overshoot — current + delta
        # must stay at or under the limit. The greatest(..., 0) clamp
        # keeps refund deltas from going negative.
        elif quota.strict:
            if meter.delta is not None:
                adjusted_expr = func.greatest(MeterDBE.value + meter.delta, 0)
            elif meter.value is not None:
                adjusted_expr = func.greatest(meter.value, 0)
            else:
                raise ValueError("Either delta or value must be set")

            where_clauses.append(adjusted_expr <= quota.limit)

        # Non-strict mode: same predictable-overshoot rule for the
        # request itself (delta <= limit, enforced by the Python-side
        # fast-path above), plus the SQL clause `value < limit` so a
        # request from below the limit can cross-the-line once. Already-
        # at-or-over-limit rows reject the next write — this is what
        # distinguishes strict from non-strict.
        else:
            if meter.delta is not None:
                where_clauses.append(MeterDBE.value < quota.limit)
            elif meter.value is not None:
                where_clauses.append(literal(meter.value <= quota.limit))
            else:
                raise ValueError("Either delta or value must be set")

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
                    meter_id=meter.meter_id,
                    #
                    organization_id=meter.organization_id,
                    workspace_id=meter.workspace_id,
                    project_id=meter.project_id,
                    user_id=meter.user_id,
                    #
                    year=meter.year,
                    month=meter.month,
                    day=meter.day,
                    #
                    key=meter.key,
                    value=desired_value,
                    synced=0,
                )
                .on_conflict_do_update(
                    index_elements=[MeterDBE.meter_id],
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
