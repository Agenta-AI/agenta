from typing import Optional, List, Tuple
from uuid import UUID
from datetime import datetime

from sqlalchemy import delete, func, literal, select, text, tuple_, bindparam
from sqlalchemy.dialects.postgresql import ARRAY, UUID as PG_UUID
from sqlalchemy.sql import any_  # SQL ANY() operator for array comparisons

from oss.src.utils.logging import get_module_logger

from oss.src.models.db_models import ProjectDB

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.tracing.dbes import SpanDBE

from ee.src.dbs.postgres.subscriptions.dbes import SubscriptionDBE


log = get_module_logger(__name__)


# --------------------------- #
# Raw SQL (text()) statements
# --------------------------- #

CORE_PROJECTS_PAGE_SQL = text(
    """
        SELECT p.id AS project_id
        FROM public.projects p
        JOIN public.subscriptions s
          ON s.organization_id = p.organization_id
        WHERE s.plan = :plan
          AND (:project_id IS NULL OR p.id > :project_id)
        ORDER BY p.id
        LIMIT :max_projects;
        """
).bindparams(
    bindparam("plan"),  # text/varchar; driver will adapt
    bindparam("project_id", type_=PG_UUID(as_uuid=True)),
    bindparam("max_projects"),
)

TRACING_DELETE_SQL = text(
    """
        WITH expired_traces AS (
          SELECT sp.project_id, sp.trace_id
          FROM public.spans sp
          WHERE sp.parent_id IS NULL
            AND sp.project_id = ANY(:project_ids::uuid[])
            AND sp.created_at < :cutoff
          ORDER BY sp.created_at
          LIMIT :max_traces
        ),
        expired_spans AS (
          DELETE FROM public.spans sp
          USING expired_traces et
          WHERE sp.project_id = et.project_id
            AND sp.trace_id   = et.trace_id
          RETURNING 1
        )
        SELECT
          (SELECT count(*) FROM expired_traces) AS traces_selected,
          (SELECT count(*) FROM expired_spans)  AS spans_deleted;
        """
).bindparams(
    bindparam("project_ids", type_=ARRAY(PG_UUID(as_uuid=True))),
    bindparam("cutoff"),  # timestamptz; driver will adapt from aware datetime
    bindparam("max_traces"),
)


class TracingDAO:
    # ---------------- #
    # Raw-SQL versions
    # ---------------- #

    async def _fetch_projects_with_plan(
        self,
        *,
        plan: str,
        project_id: Optional[UUID],
        max_projects: int,
    ) -> List[UUID]:
        async with engine.core_session() as session:
            result = await session.execute(
                CORE_PROJECTS_PAGE_SQL,
                {
                    "plan": plan,
                    "project_id": project_id if project_id else None,
                    "max_projects": max_projects,
                },
            )

            rows = result.fetchall()

            return [row[0] for row in rows]

    async def _delete_traces_before_cutoff(
        self,
        *,
        cutoff: datetime,
        project_ids: List[UUID],
        max_traces: int,
    ) -> Tuple[int, int]:
        if not project_ids:
            return (0, 0)

        async with engine.tracing_session() as session:
            result = await session.execute(
                TRACING_DELETE_SQL,
                {
                    "project_ids": project_ids,
                    "cutoff": cutoff,
                    "max_traces": max_traces,
                },
            )

            row = result.fetchone()

            await session.commit()

            traces_selected = int(row[0]) if row and row[0] is not None else 0
            spans_deleted = int(row[1]) if row and row[1] is not None else 0

            return (traces_selected, spans_deleted)

    # ------------------- #
    # SQLAlchemy versions
    # ------------------- #

    async def fetch_projects_with_plan(
        self,
        *,
        plan: str,
        project_id: Optional[UUID],
        max_projects: int,
    ) -> List[UUID]:
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

    async def delete_traces_before_cutoff(
        self,
        *,
        cutoff: datetime,
        project_ids: List[UUID],
        max_traces: int,
    ) -> Tuple[int, int]:
        if not project_ids:
            return (0, 0)

        async with engine.tracing_session() as session:
            project_ids_param = bindparam(
                "project_ids",
                value=project_ids,
                type_=ARRAY(PG_UUID(as_uuid=True)),
            )

            expired_traces = (
                select(
                    SpanDBE.project_id.label("project_id"),
                    SpanDBE.trace_id.label("trace_id"),
                )
                .where(
                    SpanDBE.parent_id.is_(None),
                    SpanDBE.project_id == any_(project_ids_param),
                    SpanDBE.created_at < bindparam("cutoff", value=cutoff),
                )
                .order_by(SpanDBE.created_at)
                .limit(bindparam("max_traces", value=max_traces))
                .cte("expired_traces")
            )

            deleted = (
                delete(SpanDBE)
                .where(
                    tuple_(SpanDBE.project_id, SpanDBE.trace_id).in_(
                        select(
                            expired_traces.c.project_id,
                            expired_traces.c.trace_id,
                        )
                    )
                )
                .returning(literal(1).label("deleted"))
                .cte("deleted")
            )

            stmt = select(
                select(func.count())
                .select_from(expired_traces)
                .scalar_subquery()
                .label("traces_selected"),
                select(func.count())
                .select_from(deleted)
                .scalar_subquery()
                .label("spans_deleted"),
            )

            result = await session.execute(stmt)

            row = result.fetchone()

            await session.commit()

            traces_selected = int(row[0]) if row and row[0] is not None else 0
            spans_deleted = int(row[1]) if row and row[1] is not None else 0

            return (traces_selected, spans_deleted)
