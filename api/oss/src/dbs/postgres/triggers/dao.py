import asyncio
from datetime import datetime, timezone
from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import cast, delete, func, literal, select, update
from sqlalchemy.dialects.postgresql import JSON, JSONB, insert
from sqlalchemy.exc import IntegrityError

from oss.src.core.shared.dtos import Status, Windowing
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.triggers.dtos import (
    TRIGGER_DELIVERY_RETRYABLE_STATUS_CODE,
    TriggerDelivery,
    TriggerDeliveryCreate,
    TriggerDeliveryData,
    TriggerDeliveryQuery,
    TriggerSchedule,
    TriggerScheduleCreate,
    TriggerScheduleEdit,
    TriggerScheduleQuery,
    TriggerSubscription,
    TriggerSubscriptionCreate,
    TriggerSubscriptionEdit,
    TriggerSubscriptionQuery,
)
from oss.src.core.triggers.interfaces import TriggersDAOInterface
from oss.src.utils.logging import get_module_logger

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.shared.utils import apply_windowing
from oss.src.dbs.postgres.triggers.dbes import (
    TriggerDeliveryDBE,
    TriggerScheduleDBE,
    TriggerSubscriptionDBE,
)
from oss.src.dbs.postgres.triggers.mappings import (
    map_delivery_dbe_to_dto,
    map_delivery_dto_to_dbe_create,
    map_schedule_dbe_to_dto,
    map_schedule_dto_to_dbe_create,
    map_schedule_dto_to_dbe_edit,
    map_subscription_dbe_to_dto,
    map_subscription_dto_to_dbe_create,
    map_subscription_dto_to_dbe_edit,
)
from oss.src.dbs.postgres.triggers.upsert_utils import (
    build_trigger_delivery_conflict,
    build_trigger_delivery_values,
)

log = get_module_logger(__name__)


class TriggersDAO(TriggersDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    # --- SUBSCRIPTIONS ------------------------------------------------------ #

    async def create_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: TriggerSubscriptionCreate,
        #
        trigger_id: str,
    ) -> TriggerSubscription:
        subscription_dbe = map_subscription_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            #
            subscription=subscription,
            #
            trigger_id=trigger_id,
        )

        try:
            async with self.engine.session() as session:
                session.add(subscription_dbe)

                await session.commit()

                await session.refresh(subscription_dbe)
        except IntegrityError as e:
            # A live subscription already occupies this provider trigger; the partial-unique
            # index forbids a second active row. Classify by the driver's constraint-name
            # metadata, falling back to the message so a duplicate never slips through to a 500.
            index_name = "ix_trigger_subscriptions_trigger_id"
            orig = getattr(e, "orig", None)
            constraint = getattr(
                getattr(orig, "__cause__", None), "constraint_name", None
            )
            if constraint == index_name or index_name in (
                str(orig) if orig else str(e)
            ):
                winner = await self.fetch_subscription_by_trigger_id(
                    project_id=project_id,
                    trigger_id=trigger_id,
                )
                conflict = {"trigger_id": trigger_id}
                if winner:
                    conflict["subscription_id"] = str(winner.id)
                raise EntityCreationConflict(
                    entity="Trigger subscription",
                    message="A subscription for this connection and event already exists.",
                    conflict=conflict,
                ) from e
            raise

        return map_subscription_dbe_to_dto(
            subscription_dbe=subscription_dbe,
        )

    async def fetch_subscription(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> Optional[TriggerSubscription]:
        async with self.engine.session() as session:
            stmt = select(TriggerSubscriptionDBE).where(
                TriggerSubscriptionDBE.project_id == project_id,
                TriggerSubscriptionDBE.id == subscription_id,
                TriggerSubscriptionDBE.deleted_at.is_(None),
            )

            result = await session.execute(stmt)

            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return None

            return map_subscription_dbe_to_dto(
                subscription_dbe=subscription_dbe,
            )

    async def fetch_subscription_including_deleted(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> Optional[TriggerSubscription]:
        async with self.engine.session() as session:
            stmt = select(TriggerSubscriptionDBE).where(
                TriggerSubscriptionDBE.project_id == project_id,
                TriggerSubscriptionDBE.id == subscription_id,
            )
            subscription_dbe = (await session.execute(stmt)).scalar_one_or_none()
            if subscription_dbe is None:
                return None
            return map_subscription_dbe_to_dto(subscription_dbe=subscription_dbe)

    async def edit_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: TriggerSubscriptionEdit,
    ) -> Optional[TriggerSubscription]:
        async with self.engine.session() as session:
            stmt = (
                select(TriggerSubscriptionDBE)
                .where(
                    TriggerSubscriptionDBE.id == subscription.id,
                    TriggerSubscriptionDBE.project_id == project_id,
                    TriggerSubscriptionDBE.deleted_at.is_(None),
                )
                .with_for_update()
            )

            result = await session.execute(stmt)

            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return None

            map_subscription_dto_to_dbe_edit(
                subscription_dbe=subscription_dbe,
                #
                user_id=user_id,
                #
                subscription=subscription,
            )

            await session.commit()

            await session.refresh(subscription_dbe)

            return map_subscription_dbe_to_dto(
                subscription_dbe=subscription_dbe,
            )

    async def delete_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription_id: UUID,
    ) -> bool:
        async with self.engine.session() as session:
            now = datetime.now(timezone.utc)
            stmt = (
                update(TriggerSubscriptionDBE)
                .where(
                    TriggerSubscriptionDBE.project_id == project_id,
                    TriggerSubscriptionDBE.id == subscription_id,
                    TriggerSubscriptionDBE.deleted_at.is_(None),
                )
                .values(
                    deleted_at=now,
                    deleted_by_id=user_id,
                    updated_at=now,
                    updated_by_id=user_id,
                )
                .returning(TriggerSubscriptionDBE.id)
            )
            result = await session.execute(stmt)
            await session.commit()
            return result.scalar_one_or_none() is not None

    async def purge_subscription(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = delete(TriggerSubscriptionDBE).where(
                TriggerSubscriptionDBE.project_id == project_id,
                TriggerSubscriptionDBE.id == subscription_id,
            )
            result = await session.execute(stmt)
            await session.commit()
            return bool(result.rowcount)

    async def mark_subscription_needs_provider_cleanup(
        self,
        *,
        project_id: UUID,
        subscription_id: UUID,
    ) -> None:
        async with self.engine.session() as session:
            merged_meta = cast(
                func.coalesce(
                    cast(TriggerSubscriptionDBE.meta, JSONB), cast({}, JSONB)
                ).op("||")(cast({"needs_provider_cleanup": True}, JSONB)),
                JSON,
            )
            stmt = (
                update(TriggerSubscriptionDBE)
                .where(
                    TriggerSubscriptionDBE.project_id == project_id,
                    TriggerSubscriptionDBE.id == subscription_id,
                )
                .values(meta=merged_meta)
            )
            await session.execute(stmt)
            await session.commit()

    async def query_subscriptions(
        self,
        *,
        project_id: UUID,
        #
        subscription: Optional[TriggerSubscriptionQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[TriggerSubscription]:
        async with self.engine.session() as session:
            stmt = select(TriggerSubscriptionDBE).filter(
                TriggerSubscriptionDBE.project_id == project_id,
                TriggerSubscriptionDBE.deleted_at.is_(None),
            )

            if subscription:
                if subscription.name is not None:
                    stmt = stmt.filter(
                        TriggerSubscriptionDBE.name.ilike(f"%{subscription.name}%"),
                    )

                if subscription.connection_id is not None:
                    stmt = stmt.filter(
                        TriggerSubscriptionDBE.connection_id
                        == subscription.connection_id,
                    )

                if subscription.event_key is not None:
                    stmt = stmt.filter(
                        TriggerSubscriptionDBE.data["event_key"].astext
                        == subscription.event_key,
                    )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=TriggerSubscriptionDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            return [
                map_subscription_dbe_to_dto(subscription_dbe=dbe)
                for dbe in result.scalars().all()
            ]

    async def fetch_subscription_by_trigger_id(
        self,
        *,
        project_id: UUID,
        trigger_id: str,
    ) -> Optional[TriggerSubscription]:
        async with self.engine.session() as session:
            stmt = (
                select(TriggerSubscriptionDBE)
                .filter(
                    TriggerSubscriptionDBE.project_id == project_id,
                    TriggerSubscriptionDBE.trigger_id == trigger_id,
                    TriggerSubscriptionDBE.deleted_at.is_(None),
                )
                .limit(1)
            )

            result = await session.execute(stmt)

            subscription_dbe = result.scalars().first()

            if not subscription_dbe:
                return None

            return map_subscription_dbe_to_dto(subscription_dbe=subscription_dbe)

    async def get_project_and_subscription_by_trigger_id(
        self,
        *,
        trigger_id: str,
    ) -> Optional[Tuple[UUID, TriggerSubscription]]:
        # Deliberately unscoped: inbound Composio events carry only the provider
        # trigger_id (ti_*) and no tenant scope, so this recovers project_id from
        # it. Duplicate live ids across projects are ambiguous and fail closed.
        async with self.engine.session() as session:
            stmt = (
                select(TriggerSubscriptionDBE)
                .filter(
                    TriggerSubscriptionDBE.trigger_id == trigger_id,
                    TriggerSubscriptionDBE.deleted_at.is_(None),
                )
                .limit(2)
            )

            result = await session.execute(stmt)
            subscription_dbes = result.scalars().all()
            if len(subscription_dbes) != 1:
                if len(subscription_dbes) > 1:
                    log.warning(
                        "[TRIGGERS] Ambiguous trigger_id across projects — "
                        "failing closed",
                        trigger_id=trigger_id,
                    )
                return None
            subscription_dbe = subscription_dbes[0]

            return (
                subscription_dbe.project_id,
                map_subscription_dbe_to_dto(subscription_dbe=subscription_dbe),
            )

    # --- DELIVERIES --------------------------------------------------------- #

    async def write_delivery(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        delivery: TriggerDeliveryCreate,
    ) -> TriggerDelivery:
        delivery_dbe = map_delivery_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            #
            delivery=delivery,
        )

        by_schedule = delivery.subscription_id is None
        index_elements, index_where = build_trigger_delivery_conflict(by_schedule)

        async with self.engine.session() as session:
            values = build_trigger_delivery_values(delivery_dbe)

            stmt = insert(TriggerDeliveryDBE).values(**values)
            stmt = stmt.on_conflict_do_update(
                index_elements=index_elements,
                index_where=index_where,
                set_={
                    "status": stmt.excluded.status,
                    "data": stmt.excluded.data,
                    "updated_at": datetime.now(timezone.utc),
                    "updated_by_id": stmt.excluded.created_by_id,
                },
            )
            await session.execute(stmt)
            await session.commit()

            refreshed_stmt = select(TriggerDeliveryDBE).where(
                TriggerDeliveryDBE.project_id == project_id,
                TriggerDeliveryDBE.schedule_id == delivery.schedule_id
                if by_schedule
                else TriggerDeliveryDBE.subscription_id == delivery.subscription_id,
                TriggerDeliveryDBE.event_id == delivery.event_id,
            )
            delivery_dbe = (await session.execute(refreshed_stmt)).scalar_one()

        return map_delivery_dbe_to_dto(
            delivery_dbe=delivery_dbe,
        )

    async def write_subscription_delivery_if_live(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        delivery: TriggerDeliveryCreate,
    ) -> Optional[TriggerDelivery]:
        if delivery.subscription_id is None or delivery.schedule_id is not None:
            return None

        delivery_dbe = map_delivery_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            delivery=delivery,
        )
        values = build_trigger_delivery_values(delivery_dbe)
        index_elements, index_where = build_trigger_delivery_conflict(by_schedule=False)
        live_subscription = (
            select(TriggerSubscriptionDBE.id)
            .where(
                TriggerSubscriptionDBE.project_id == project_id,
                TriggerSubscriptionDBE.id == delivery.subscription_id,
                TriggerSubscriptionDBE.deleted_at.is_(None),
                # Deliberately `is_active` only, NOT `is_active AND is_valid` like
                # `claim_trigger_delivery`'s real-invocation gate. The dispatcher
                # calls this to record the "subscription is invalid" 409 delivery
                # itself (dispatcher.py's `is_valid` branch), reached precisely
                # when is_valid is False — requiring is_valid here would silently
                # drop that failure explanation instead of recording it.
                TriggerSubscriptionDBE.flags.contains({"is_active": True}),
            )
            .with_for_update()
            .cte("live_trigger_subscription")
        )
        columns = list(values)
        stmt = insert(TriggerDeliveryDBE).from_select(
            columns,
            select(
                *(
                    literal(
                        values[column],
                        type_=TriggerDeliveryDBE.__table__.c[column].type,
                    )
                    for column in columns
                )
            ).select_from(live_subscription),
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=index_elements,
            index_where=index_where,
            set_={
                "status": stmt.excluded.status,
                # Merge, not replace (P2-4): two redeliveries racing `dedup_seen` can
                # both reach this upsert; a wholesale replace can drop fields the
                # first write set (e.g. `data.session_id`) while the session still
                # points at this delivery. Mirrors `update_delivery`'s merge.
                "data": cast(
                    func.coalesce(
                        cast(TriggerDeliveryDBE.data, JSONB), cast({}, JSONB)
                    ).op("||")(cast(stmt.excluded.data, JSONB)),
                    JSON,
                ),
                "updated_at": datetime.now(timezone.utc),
                "updated_by_id": stmt.excluded.created_by_id,
            },
        ).returning(TriggerDeliveryDBE)

        async with self.engine.session() as session:
            result = await session.execute(stmt)
            delivery_dbe = result.scalar_one_or_none()
            await session.commit()

        if delivery_dbe is None:
            return None
        return map_delivery_dbe_to_dto(delivery_dbe=delivery_dbe)

    async def update_delivery(
        self,
        *,
        project_id: UUID,
        delivery_id: UUID,
        #
        status: Status,
        data: Optional[TriggerDeliveryData] = None,
    ) -> Optional[TriggerDelivery]:
        async with self.engine.session() as session:
            values = {
                "status": status.model_dump(mode="json", exclude_none=True),
                "updated_at": datetime.now(timezone.utc),
            }
            if data is not None:
                update_data = cast(
                    data.model_dump(mode="json", exclude_none=True), JSONB
                )
                values["data"] = cast(
                    func.coalesce(
                        cast(TriggerDeliveryDBE.data, JSONB), cast({}, JSONB)
                    ).op("||")(update_data),
                    JSON,
                )

            stmt = (
                update(TriggerDeliveryDBE)
                .where(
                    TriggerDeliveryDBE.project_id == project_id,
                    TriggerDeliveryDBE.id == delivery_id,
                )
                .values(**values)
                .returning(TriggerDeliveryDBE)
            )
            result = await session.execute(stmt)
            delivery_dbe = result.scalar_one_or_none()
            await session.commit()

            if delivery_dbe is None:
                return None

        return map_delivery_dbe_to_dto(
            delivery_dbe=delivery_dbe,
        )

    async def fetch_delivery(
        self,
        *,
        project_id: UUID,
        #
        delivery_id: UUID,
    ) -> Optional[TriggerDelivery]:
        async with self.engine.session() as session:
            stmt = select(TriggerDeliveryDBE).where(
                TriggerDeliveryDBE.project_id == project_id,
                TriggerDeliveryDBE.id == delivery_id,
            )

            result = await session.execute(stmt)

            delivery_dbe = result.scalar_one_or_none()

            if not delivery_dbe:
                return None

            return map_delivery_dbe_to_dto(
                delivery_dbe=delivery_dbe,
            )

    async def query_deliveries(
        self,
        *,
        project_id: UUID,
        #
        delivery: Optional[TriggerDeliveryQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[TriggerDelivery]:
        async with self.engine.session() as session:
            stmt = select(TriggerDeliveryDBE).filter(
                TriggerDeliveryDBE.project_id == project_id,
            )

            if delivery:
                if delivery.status is not None and delivery.status.code is not None:
                    stmt = stmt.filter(
                        TriggerDeliveryDBE.status["code"].astext
                        == str(delivery.status.code),
                    )

                if delivery.subscription_id is not None:
                    stmt = stmt.filter(
                        TriggerDeliveryDBE.subscription_id == delivery.subscription_id,
                    )

                if delivery.schedule_id is not None:
                    stmt = stmt.filter(
                        TriggerDeliveryDBE.schedule_id == delivery.schedule_id,
                    )

                if delivery.event_id is not None:
                    stmt = stmt.filter(
                        TriggerDeliveryDBE.event_id == delivery.event_id,
                    )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=TriggerDeliveryDBE,
                    attribute="created_at",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            return [
                map_delivery_dbe_to_dto(delivery_dbe=dbe)
                for dbe in result.scalars().all()
            ]

    async def poll_delivery_after(
        self,
        *,
        project_id: UUID,
        subscription_id: UUID,
        baseline_id: Optional[UUID],
        timeout_seconds: float,
        interval_seconds: float = 1.0,
    ) -> Optional[TriggerDelivery]:
        stmt = (
            select(TriggerDeliveryDBE)
            .filter(
                TriggerDeliveryDBE.project_id == project_id,
                TriggerDeliveryDBE.subscription_id == subscription_id,
            )
            .order_by(TriggerDeliveryDBE.created_at.desc())
            .limit(1)
        )

        # One held connection for the whole wait, instead of a fresh checkout per tick.
        async with self.engine.session() as session:
            deadline = asyncio.get_event_loop().time() + timeout_seconds
            while asyncio.get_event_loop().time() < deadline:
                result = await session.execute(stmt)
                dbe = result.scalars().first()

                if dbe is not None and dbe.id != baseline_id:
                    return map_delivery_dbe_to_dto(delivery_dbe=dbe)

                await asyncio.sleep(interval_seconds)

            return None

    async def dedup_seen(
        self,
        *,
        project_id: UUID,
        subscription_id: UUID,
        event_id: str,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = (
                select(TriggerDeliveryDBE.status)
                .where(
                    TriggerDeliveryDBE.project_id == project_id,
                    TriggerDeliveryDBE.subscription_id == subscription_id,
                    TriggerDeliveryDBE.event_id == event_id,
                )
                .limit(1)
            )

            status = (await session.execute(stmt)).scalar_one_or_none()

        return self._dedup_seen_from_status(
            status=status,
            subscription_id=subscription_id,
            event_id=event_id,
        )

    async def dedup_seen_schedule(
        self,
        *,
        project_id: UUID,
        schedule_id: UUID,
        event_id: str,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = (
                select(TriggerDeliveryDBE.status)
                .where(
                    TriggerDeliveryDBE.project_id == project_id,
                    TriggerDeliveryDBE.schedule_id == schedule_id,
                    TriggerDeliveryDBE.event_id == event_id,
                )
                .limit(1)
            )

            status = (await session.execute(stmt)).scalar_one_or_none()

        return self._dedup_seen_from_status(
            status=status,
            subscription_id=schedule_id,
            event_id=event_id,
        )

    @staticmethod
    def _dedup_seen_from_status(
        *,
        status: Optional[dict],
        subscription_id: UUID,
        event_id: str,
    ) -> bool:
        """No row at all is unambiguously unseen. A row stuck in the one
        retryable terminal state (P1-8) is NOT a duplicate either — the retry
        must reach the atomic claim, the actual authority on whether a
        re-claim wins, instead of short-circuiting here. Every other status
        (claimed, success, or a permanent failure) is a genuine duplicate."""
        if status is None:
            return False
        if (status or {}).get("code") == TRIGGER_DELIVERY_RETRYABLE_STATUS_CODE:
            log.info(
                "[TRIGGERS] Retryable delivery found for (parent=%s, event=%s) "
                "— treating as a retry, not a duplicate",
                subscription_id,
                event_id,
            )
            return False
        return True

    # --- SCHEDULES ---------------------------------------------------------- #

    async def create_schedule(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        schedule: TriggerScheduleCreate,
    ) -> TriggerSchedule:
        schedule_dbe = map_schedule_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            #
            schedule=schedule,
        )

        async with self.engine.session() as session:
            session.add(schedule_dbe)

            await session.commit()

            await session.refresh(schedule_dbe)

        return map_schedule_dbe_to_dto(
            schedule_dbe=schedule_dbe,
        )

    async def fetch_schedule(
        self,
        *,
        project_id: UUID,
        #
        schedule_id: UUID,
    ) -> Optional[TriggerSchedule]:
        async with self.engine.session() as session:
            stmt = select(TriggerScheduleDBE).where(
                TriggerScheduleDBE.project_id == project_id,
                TriggerScheduleDBE.id == schedule_id,
                TriggerScheduleDBE.deleted_at.is_(None),
            )

            result = await session.execute(stmt)

            schedule_dbe = result.scalar_one_or_none()

            if not schedule_dbe:
                return None

            return map_schedule_dbe_to_dto(
                schedule_dbe=schedule_dbe,
            )

    async def fetch_schedule_including_deleted(
        self,
        *,
        project_id: UUID,
        #
        schedule_id: UUID,
    ) -> Optional[TriggerSchedule]:
        async with self.engine.session() as session:
            stmt = select(TriggerScheduleDBE).where(
                TriggerScheduleDBE.project_id == project_id,
                TriggerScheduleDBE.id == schedule_id,
            )
            schedule_dbe = (await session.execute(stmt)).scalar_one_or_none()
            if schedule_dbe is None:
                return None
            return map_schedule_dbe_to_dto(schedule_dbe=schedule_dbe)

    async def edit_schedule(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        schedule: TriggerScheduleEdit,
    ) -> Optional[TriggerSchedule]:
        async with self.engine.session() as session:
            stmt = (
                select(TriggerScheduleDBE)
                .where(
                    TriggerScheduleDBE.id == schedule.id,
                    TriggerScheduleDBE.project_id == project_id,
                    TriggerScheduleDBE.deleted_at.is_(None),
                )
                .with_for_update()
            )

            result = await session.execute(stmt)

            schedule_dbe = result.scalar_one_or_none()

            if not schedule_dbe:
                return None

            map_schedule_dto_to_dbe_edit(
                schedule_dbe=schedule_dbe,
                #
                user_id=user_id,
                #
                schedule=schedule,
            )

            await session.commit()

            await session.refresh(schedule_dbe)

            return map_schedule_dbe_to_dto(
                schedule_dbe=schedule_dbe,
            )

    async def delete_schedule(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        schedule_id: UUID,
    ) -> bool:
        async with self.engine.session() as session:
            now = datetime.now(timezone.utc)
            stmt = (
                update(TriggerScheduleDBE)
                .where(
                    TriggerScheduleDBE.project_id == project_id,
                    TriggerScheduleDBE.id == schedule_id,
                    TriggerScheduleDBE.deleted_at.is_(None),
                )
                .values(
                    deleted_at=now,
                    deleted_by_id=user_id,
                    updated_at=now,
                    updated_by_id=user_id,
                )
                .returning(TriggerScheduleDBE.id)
            )
            result = await session.execute(stmt)
            await session.commit()
            return result.scalar_one_or_none() is not None

    async def purge_schedule(
        self,
        *,
        project_id: UUID,
        #
        schedule_id: UUID,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = delete(TriggerScheduleDBE).where(
                TriggerScheduleDBE.project_id == project_id,
                TriggerScheduleDBE.id == schedule_id,
            )
            result = await session.execute(stmt)
            await session.commit()
            return bool(result.rowcount)

    async def query_schedules(
        self,
        *,
        project_id: UUID,
        #
        schedule: Optional[TriggerScheduleQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[TriggerSchedule]:
        async with self.engine.session() as session:
            stmt = select(TriggerScheduleDBE).filter(
                TriggerScheduleDBE.project_id == project_id,
                TriggerScheduleDBE.deleted_at.is_(None),
            )

            if schedule:
                if schedule.name is not None:
                    stmt = stmt.filter(
                        TriggerScheduleDBE.name.ilike(f"%{schedule.name}%"),
                    )

                if schedule.event_key is not None:
                    stmt = stmt.filter(
                        TriggerScheduleDBE.data["event_key"].astext
                        == schedule.event_key,
                    )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=TriggerScheduleDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            return [
                map_schedule_dbe_to_dto(schedule_dbe=dbe)
                for dbe in result.scalars().all()
            ]

    async def fetch_active_schedules(
        self,
        *,
        project_id: Optional[UUID] = None,
    ) -> List[TriggerSchedule]:
        async with self.engine.session() as session:
            stmt = select(TriggerScheduleDBE).where(
                TriggerScheduleDBE.flags.contains({"is_active": True}),
                TriggerScheduleDBE.deleted_at.is_(None),
            )

            if project_id is not None:
                stmt = stmt.where(
                    TriggerScheduleDBE.project_id == project_id,
                )

            result = await session.execute(stmt)

            return [
                map_schedule_dbe_to_dto(schedule_dbe=dbe)
                for dbe in result.scalars().all()
            ]

    async def fetch_active_schedules_with_project(
        self,
        *,
        project_id: Optional[UUID] = None,
    ) -> List[Tuple[UUID, TriggerSchedule]]:
        async with self.engine.session() as session:
            stmt = select(TriggerScheduleDBE).where(
                TriggerScheduleDBE.flags.contains({"is_active": True}),
                TriggerScheduleDBE.deleted_at.is_(None),
            )

            if project_id is not None:
                stmt = stmt.where(
                    TriggerScheduleDBE.project_id == project_id,
                )

            result = await session.execute(stmt)

            schedules: List[Tuple[UUID, TriggerSchedule]] = []
            for dbe in result.scalars().all():
                try:
                    schedules.append(
                        (dbe.project_id, map_schedule_dbe_to_dto(schedule_dbe=dbe))
                    )
                except Exception as e:  # pylint: disable=broad-exception-caught
                    # One malformed row must not drop every project's active
                    # schedules for the tick; skip it and keep the rest.
                    # Pydantic's ValidationError.__str__ embeds the offending
                    # input_value, so log the exception type only, never {e}.
                    log.error(
                        "[SCHEDULE] Skipping malformed schedule row",
                        schedule_id=str(dbe.id),
                        project_id=str(dbe.project_id),
                        error_type=type(e).__name__,
                    )

            return schedules
