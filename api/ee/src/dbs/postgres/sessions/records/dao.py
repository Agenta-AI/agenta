"""EE records DAO (retention).

Walks ``projects ⋈ subscriptions`` to find projects on a given plan, then
deletes record rows older than the retention cutoff. Lives in EE because
the project-to-plan join goes through the EE ``SubscriptionDBE`` table.

The OSS counterpart (``oss.src.dbs.postgres.sessions.records.dao.RecordsDAO``)
owns append/query and never imports EE types.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from sqlalchemy import bindparam, delete, func, literal, select, tuple_
from sqlalchemy.dialects.postgresql import ARRAY, UUID as PG_UUID
from sqlalchemy.sql import any_

from oss.src.utils.logging import get_module_logger

from oss.src.models.db_models import ProjectDB

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    AnalyticsEngine,
    get_transactions_engine,
    get_analytics_engine,
)
from oss.src.dbs.postgres.sessions.records.dbes import RecordDBE

from ee.src.dbs.postgres.subscriptions.dbes import SubscriptionDBE


log = get_module_logger(__name__)


class RecordsRetentionDAO:
    """EE records DAO (retention only)."""

    def __init__(
        self,
        transactions_engine: Optional[TransactionsEngine] = None,
        analytics_engine: Optional[AnalyticsEngine] = None,
    ):
        if transactions_engine is None:
            transactions_engine = get_transactions_engine()
        if analytics_engine is None:
            analytics_engine = get_analytics_engine()
        self.transactions_engine = transactions_engine
        self.analytics_engine = analytics_engine

    async def fetch_projects_with_plan(
        self,
        *,
        plan: str,
        project_id: UUID | None,
        max_projects: int,
    ) -> List[UUID]:
        """Page through projects whose org subscribes to the given plan."""
        async with self.transactions_engine.session() as session:
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

    async def delete_records_before_cutoff(
        self,
        *,
        cutoff: datetime,
        project_ids: List[UUID],
        max_records: int,
    ) -> int:
        """Delete up to ``max_records`` rows with ``created_at < cutoff``
        in the given projects. Returns the number of rows deleted.
        """
        if not project_ids:
            return 0

        async with self.analytics_engine.session() as session:
            project_ids_param = bindparam(
                "project_ids",
                value=project_ids,
                type_=ARRAY(PG_UUID(as_uuid=True)),
            )

            expired = (
                select(
                    RecordDBE.project_id.label("project_id"),
                    RecordDBE.id.label("id"),
                )
                .where(
                    RecordDBE.project_id == any_(project_ids_param),
                    RecordDBE.created_at < bindparam("cutoff", value=cutoff),
                )
                .order_by(RecordDBE.created_at)
                .limit(bindparam("max_records", value=max_records))
                .cte("expired_records")
            )

            deleted = (
                delete(RecordDBE)
                .where(
                    tuple_(RecordDBE.project_id, RecordDBE.id).in_(
                        select(expired.c.project_id, expired.c.id)
                    )
                )
                .returning(literal(1).label("deleted"))
                .cte("deleted")
            )

            stmt = select(
                select(func.count())
                .select_from(deleted)
                .scalar_subquery()
                .label("records_deleted"),
            )

            result = await session.execute(stmt)
            row = result.fetchone()

            await session.commit()

            return int(row[0]) if row and row[0] is not None else 0
