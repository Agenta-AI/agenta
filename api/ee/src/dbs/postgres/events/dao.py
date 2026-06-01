"""EE events DAO (retention).

Walks ``projects ⋈ subscriptions`` to find projects on a given plan, then
deletes events older than a cutoff from the ``events`` table. Lives in EE
because the project-to-plan join goes through the EE ``SubscriptionDBE``
table — same reason ``ee.src.dbs.postgres.tracing.dao.TracingRetentionDAO`` is
EE-side.

The OSS counterpart (``oss.src.dbs.postgres.events.dao.EventsDAO``) owns
ingest/query and never imports EE types.
"""

from datetime import datetime
from typing import List
from uuid import UUID

from sqlalchemy import bindparam, delete, func, literal, select, tuple_
from sqlalchemy.dialects.postgresql import ARRAY, UUID as PG_UUID
from sqlalchemy.sql import any_

from oss.src.utils.logging import get_module_logger

from oss.src.models.db_models import ProjectDB

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.events.dbes import EventDBE

from ee.src.dbs.postgres.subscriptions.dbes import SubscriptionDBE


log = get_module_logger(__name__)


class EventsRetentionDAO:
    """EE events DAO (retention).

    ``oss.src.dbs.postgres.events.dao.EventsDAO`` owns ingest/query; this class
    owns retention only.
    """

    async def fetch_projects_with_plan(
        self,
        *,
        plan: str,
        project_id: UUID | None,
        max_projects: int,
    ) -> List[UUID]:
        """Page through projects whose org subscribes to the given plan."""
        async with engine.core_session() as session:
            stmt = (
                select(ProjectDB.id)
                .select_from(
                    ProjectDB.__table__.join(
                        SubscriptionDBE.__table__,
                        SubscriptionDBE.organization_id == ProjectDB.organization_id,
                    )
                )
                .where(SubscriptionDBE.plan == plan)
            )

            if project_id:
                stmt = stmt.where(ProjectDB.id > project_id)

            stmt = stmt.order_by(ProjectDB.id).limit(max_projects)

            result = await session.execute(stmt)
            rows = result.fetchall()

            return [row[0] for row in rows]

    async def delete_events_before_cutoff(
        self,
        *,
        cutoff: datetime,
        project_ids: List[UUID],
        max_events: int,
    ) -> int:
        """Delete up to ``max_events`` events with ``created_at < cutoff`` in the
        given projects. Returns the number of rows deleted.

        Note: ``events`` are independent rows (not joined to a parent like
        ``spans`` → ``traces``), so the query is a single bounded delete rather
        than a parent-first selection. The
        ``ix_events_project_id_request_id_created_at`` index covers
        ``project_id`` + ``created_at`` access.
        """
        if not project_ids:
            return 0

        async with engine.tracing_session() as session:
            project_ids_param = bindparam(
                "project_ids",
                value=project_ids,
                type_=ARRAY(PG_UUID(as_uuid=True)),
            )

            expired = (
                select(
                    EventDBE.project_id.label("project_id"),
                    EventDBE.request_id.label("request_id"),
                    EventDBE.event_id.label("event_id"),
                )
                .where(
                    EventDBE.project_id == any_(project_ids_param),
                    EventDBE.created_at < bindparam("cutoff", value=cutoff),
                )
                .order_by(EventDBE.created_at)
                .limit(bindparam("max_events", value=max_events))
                .cte("expired_events")
            )

            deleted = (
                delete(EventDBE)
                .where(
                    tuple_(
                        EventDBE.project_id, EventDBE.request_id, EventDBE.event_id
                    ).in_(
                        select(
                            expired.c.project_id,
                            expired.c.request_id,
                            expired.c.event_id,
                        )
                    )
                )
                .returning(literal(1).label("deleted"))
                .cte("deleted")
            )

            stmt = select(
                select(func.count())
                .select_from(deleted)
                .scalar_subquery()
                .label("events_deleted"),
            )

            result = await session.execute(stmt)
            row = result.fetchone()

            await session.commit()

            return int(row[0]) if row and row[0] is not None else 0
