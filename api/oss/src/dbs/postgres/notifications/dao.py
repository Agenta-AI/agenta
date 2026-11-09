from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence
from uuid import UUID

import uuid_utils.compat as uuid
from sqlalchemy import and_, case, func, select, text, update
from sqlalchemy.dialects.postgresql import insert

from oss.src.core.notifications.dtos import (
    NotificationChannel,
    NotificationDeliveryState,
    NotificationKind,
    NotificationState,
    CreatedNotificationDelivery,
)
from oss.src.core.notifications.interfaces import NotificationsDAOInterface
from oss.src.dbs.postgres.notifications.dbes import (
    NotificationDBE,
    NotificationDeliveryDBE,
)
from oss.src.dbs.postgres.notifications.mappings import map_created_delivery
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)

_OPEN = NotificationState.OPEN.value
_CREATED = NotificationDeliveryState.CREATED.value

_RESOLVE_SQL = """
UPDATE notifications
SET state = :resolved, updated_at = now()
WHERE project_id = :project_id AND dedup_key = :dedup_key AND state = :open
"""

_RESOLVE_STARTED_AT_FILTER = """
  AND (data->>'last_failure_started_at')::timestamptz <= :started_at
"""

# `started_at` and `started_at_text` are separate binds: one bind cannot be both a
# timestamptz and a text value to asyncpg.
_NOTE_FAILURE_SQL = """
UPDATE notifications
SET data = CASE
        WHEN (data->>'last_failure_started_at')::timestamptz < :started_at
        THEN jsonb_set(data, '{last_failure_started_at}', to_jsonb(CAST(:started_at_text AS text)))
        ELSE data
    END,
    updated_at = now()
WHERE project_id = :project_id AND dedup_key = :dedup_key AND state = :open
"""


class NotificationsDAO(NotificationsDAOInterface):
    def __init__(self, engine: Optional[TransactionsEngine] = None):
        self.engine = engine or get_transactions_engine()

    async def open(
        self,
        *,
        project_id: UUID,
        kind: NotificationKind,
        dedup_key: str,
        data: Dict[str, Any],
        user_ids: Sequence[UUID],
    ) -> bool:
        notification_id = uuid.uuid7()
        insert_notification = (
            insert(NotificationDBE)
            .values(
                project_id=project_id,
                id=notification_id,
                kind=kind.value,
                dedup_key=dedup_key,
                state=_OPEN,
                data=data,
            )
            .on_conflict_do_nothing(
                index_elements=["project_id", "dedup_key"],
                index_where=text("state = 'open'"),
            )
            .returning(NotificationDBE.id)
        )

        async with self.engine.session() as session:
            opened = (await session.execute(insert_notification)).scalar_one_or_none()
            if opened is None:
                await session.commit()
                return False

            if user_ids:
                await session.execute(
                    insert(NotificationDeliveryDBE).values(
                        [
                            {
                                "project_id": project_id,
                                "id": uuid.uuid7(),
                                "notification_id": notification_id,
                                "user_id": user_id,
                                "channel": NotificationChannel.EMAIL.value,
                                "state": _CREATED,
                                "attempt_count": 0,
                            }
                            for user_id in user_ids
                        ]
                    )
                )
            await session.commit()
        return True

    async def resolve(
        self,
        *,
        project_id: UUID,
        dedup_key: str,
        started_at: Optional[datetime] = None,
    ) -> int:
        sql = _RESOLVE_SQL
        params: Dict[str, Any] = {
            "project_id": project_id,
            "dedup_key": dedup_key,
            "open": _OPEN,
            "resolved": NotificationState.RESOLVED.value,
        }
        if started_at is not None:
            sql += _RESOLVE_STARTED_AT_FILTER
            params["started_at"] = started_at

        async with self.engine.session() as session:
            rowcount = (await session.execute(text(sql), params)).rowcount
            await session.commit()
        return rowcount

    async def note_failure(
        self,
        *,
        project_id: UUID,
        dedup_key: str,
        started_at: datetime,
    ) -> int:
        async with self.engine.session() as session:
            result = await session.execute(
                text(_NOTE_FAILURE_SQL),
                {
                    "project_id": project_id,
                    "dedup_key": dedup_key,
                    "open": _OPEN,
                    "started_at": started_at,
                    "started_at_text": started_at.astimezone(timezone.utc).isoformat(),
                },
            )
            rowcount = result.rowcount
            await session.commit()
        return rowcount

    async def query_created(
        self,
        *,
        limit: int,
    ) -> List[CreatedNotificationDelivery]:
        stmt = (
            select(NotificationDeliveryDBE, NotificationDBE)
            .join(
                NotificationDBE,
                and_(
                    NotificationDBE.project_id == NotificationDeliveryDBE.project_id,
                    NotificationDBE.id == NotificationDeliveryDBE.notification_id,
                ),
            )
            .where(NotificationDeliveryDBE.state == _CREATED)
            .order_by(
                NotificationDeliveryDBE.created_at.asc(),
                NotificationDeliveryDBE.id.asc(),
            )
            .limit(limit)
        )
        async with self.engine.session() as session:
            rows = (await session.execute(stmt)).all()
        return [
            map_created_delivery(delivery_dbe=delivery, notification_dbe=notification)
            for delivery, notification in rows
        ]

    async def mark_sent(self, *, project_id: UUID, delivery_id: UUID) -> None:
        await self._update_created(
            project_id=project_id,
            delivery_id=delivery_id,
            values={
                "state": NotificationDeliveryState.SENT.value,
                "sent_at": func.now(),
            },
        )

    async def mark_skipped(self, *, project_id: UUID, delivery_id: UUID) -> None:
        await self._update_created(
            project_id=project_id,
            delivery_id=delivery_id,
            values={"state": NotificationDeliveryState.SKIPPED.value},
        )

    async def record_failure(
        self,
        *,
        project_id: UUID,
        delivery_id: UUID,
        max_attempts: int,
    ) -> None:
        attempts = NotificationDeliveryDBE.attempt_count + 1
        await self._update_created(
            project_id=project_id,
            delivery_id=delivery_id,
            values={
                "attempt_count": attempts,
                "state": case(
                    (attempts >= max_attempts, NotificationDeliveryState.FAILED.value),
                    else_=NotificationDeliveryDBE.state,
                ),
            },
        )

    async def _update_created(
        self,
        *,
        project_id: UUID,
        delivery_id: UUID,
        values: Dict[str, Any],
    ) -> None:
        stmt = (
            update(NotificationDeliveryDBE)
            .where(
                NotificationDeliveryDBE.project_id == project_id,
                NotificationDeliveryDBE.id == delivery_id,
                NotificationDeliveryDBE.state == _CREATED,
            )
            .values(**values, updated_at=func.now())
        )
        async with self.engine.session() as session:
            await session.execute(stmt)
            await session.commit()
