from contextlib import asynccontextmanager
from datetime import datetime
from typing import AsyncIterator, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import bindparam, func, literal_column, select, text, update
from sqlalchemy.dialects.postgresql import ARRAY, UUID as PG_UUID
from sqlalchemy.exc import DBAPIError

from oss.src.dbs.postgres.instances.dbes import InstanceDBE
from oss.src.dbs.postgres.shared.engine import (
    get_analytics_engine,
    get_transactions_engine,
)

HEARTBEAT_INTERVAL = literal_column("interval '12 hours'")
# `evaluation_runs` and `session_turns` have no index on `created_at`, so their window
# counts scan the table. A count that runs longer is sent as null.
WINDOW_COUNT_TIMEOUT = text("SET LOCAL statement_timeout = '5s'")


def _is_statement_timeout(error: DBAPIError) -> bool:
    # The same rule as the tracing DAO: 57014 also covers a cancel on user request.
    orig = error.orig
    return getattr(orig, "sqlstate", None) in (None, "57014") and (
        "statement timeout" in str(orig)
    )


async def _count_or_none(scope, statement, params) -> Optional[int]:
    """Run one count in its own transaction from `scope`. The error is handled after
    the transaction rolled back."""

    try:
        async with scope() as executor:
            await executor.execute(WINDOW_COUNT_TIMEOUT)
            return int((await executor.execute(statement, params)).scalar_one())
    except DBAPIError as error:
        if not _is_statement_timeout(error):
            raise
        return None


class InstancesDAO:
    async def fetch_instance_id(self) -> Optional[UUID]:
        async with get_transactions_engine().transaction() as connection:
            result = await connection.execute(select(InstanceDBE.id).limit(1))
            return result.scalar_one_or_none()

    @asynccontextmanager
    async def lock_unsent_install_ping(self) -> AsyncIterator[Optional[UUID]]:
        """Yield the instance id while its row is locked, when the install ping is due.

        Due means: not sent yet, and at least one organization exists. Another container
        skips the locked row and gets None. A normal exit marks the ping as sent and
        commits; an exception rolls the transaction back, so the ping stays due.
        """

        async with get_transactions_engine().transaction() as connection:
            result = await connection.execute(
                select(InstanceDBE.id)
                .where(InstanceDBE.installed_event_sent_at.is_(None))
                .where(text("EXISTS (SELECT 1 FROM organizations)"))
                .with_for_update(skip_locked=True)
            )
            instance_id = result.scalar_one_or_none()

            yield instance_id

            if instance_id is not None:
                await connection.execute(
                    update(InstanceDBE)
                    .where(InstanceDBE.id == instance_id)
                    .values(installed_event_sent_at=func.now())
                )

    def _heartbeat_due(self):
        return (InstanceDBE.heartbeat_sent_at.is_(None)) | (
            InstanceDBE.heartbeat_sent_at < func.now() - HEARTBEAT_INTERVAL
        )

    async def fetch_due_heartbeat_window(
        self,
    ) -> Optional[Tuple[UUID, Optional[datetime], datetime, datetime]]:
        """`(instance_id, heartbeat_sent_at, created_at, now)` when a telemetry
        heartbeat is due, else None. Reads without a lock, so the counts can be
        collected before `lock_due_heartbeat` takes it."""

        async with get_transactions_engine().transaction() as connection:
            result = await connection.execute(
                select(
                    InstanceDBE.id,
                    InstanceDBE.heartbeat_sent_at,
                    InstanceDBE.created_at,
                    func.now(),
                ).where(self._heartbeat_due())
            )
            row = result.first()
            return tuple(row) if row is not None else None

    @asynccontextmanager
    async def lock_due_heartbeat(
        self,
        *,
        heartbeat_sent_at: Optional[datetime],
        window_end: datetime,
    ) -> AsyncIterator[bool]:
        """Yield True while the row is locked, when the heartbeat is still due and no
        other container sent one since `heartbeat_sent_at` was read.

        Another container skips the locked row and gets False. A normal exit sets
        `heartbeat_sent_at` to `window_end` and commits; an exception rolls back.
        """

        async with get_transactions_engine().transaction() as connection:
            result = await connection.execute(
                select(InstanceDBE.id)
                .where(self._heartbeat_due())
                .where(
                    InstanceDBE.heartbeat_sent_at.is_not_distinct_from(
                        heartbeat_sent_at
                    )
                )
                .with_for_update(skip_locked=True)
            )
            instance_id = result.scalar_one_or_none()

            yield instance_id is not None

            if instance_id is not None:
                await connection.execute(
                    update(InstanceDBE)
                    .where(InstanceDBE.id == instance_id)
                    .values(heartbeat_sent_at=window_end)
                )

    async def count_totals(self) -> Tuple[int, int, int, int, List[UUID]]:
        """`(organizations, projects, users, workflows, project_ids)`."""

        async with get_transactions_engine().transaction() as connection:
            totals = (
                await connection.execute(
                    text(
                        "SELECT"
                        " (SELECT count(*) FROM organizations),"
                        " (SELECT count(*) FROM projects),"
                        " (SELECT count(*) FROM users),"
                        " (SELECT count(*) FROM workflow_artifacts"
                        "  WHERE deleted_at IS NULL)"
                    )
                )
            ).one()
            project_ids = (
                (await connection.execute(text("SELECT id FROM projects")))
                .scalars()
                .all()
            )
            return (*totals, list(project_ids))

    async def count_window_evaluation_runs(
        self, *, window_start: datetime, window_end: datetime
    ) -> Optional[int]:
        return await _count_or_none(
            get_transactions_engine().transaction,
            text(
                "SELECT count(*) FROM evaluation_runs"
                " WHERE created_at >= :start AND created_at < :end"
            ),
            {"start": window_start, "end": window_end},
        )

    async def count_window_session_turns(
        self, *, window_start: datetime, window_end: datetime
    ) -> Optional[int]:
        return await _count_or_none(
            get_transactions_engine().transaction,
            text(
                "SELECT count(*) FROM session_turns"
                " WHERE created_at >= :start AND created_at < :end"
            ),
            {"start": window_start, "end": window_end},
        )

    async def count_window_spans(
        self,
        *,
        project_ids: List[UUID],
        window_start: datetime,
        window_end: datetime,
    ) -> Optional[int]:
        """Spans that started in the window. One range scan of
        `ix_project_id_start_time` per project, never a scan of the whole table."""

        if not project_ids:
            return 0

        statement = text(
            "SELECT coalesce(sum(per_project.n), 0) FROM unnest(:project_ids) AS p(id)"
            " CROSS JOIN LATERAL (SELECT count(*) AS n FROM spans"
            "  WHERE spans.project_id = p.id"
            "  AND spans.start_time >= :start AND spans.start_time < :end"
            ") AS per_project"
        ).bindparams(
            bindparam("project_ids", type_=ARRAY(PG_UUID(as_uuid=True))),
        )

        return await _count_or_none(
            get_analytics_engine().session,
            statement,
            {
                "project_ids": project_ids,
                "start": window_start,
                "end": window_end,
            },
        )

    async def top_email_domains(self, *, limit: int) -> List[Tuple[str, int]]:
        """`(domain, users)` for the most common email domains, lowercased."""

        async with get_transactions_engine().transaction() as connection:
            result = await connection.execute(
                text(
                    "SELECT lower(split_part(email, '@', 2)) AS domain,"
                    " count(*) AS users FROM users"
                    " WHERE split_part(email, '@', 2) <> ''"
                    " GROUP BY 1 ORDER BY users DESC, domain LIMIT :limit"
                ),
                {"limit": limit},
            )
            return [(row[0], int(row[1])) for row in result]
