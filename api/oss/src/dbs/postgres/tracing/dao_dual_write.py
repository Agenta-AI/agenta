"""
Dual-write DAO for PostgreSQL and ClickHouse.

This DAO wraps both PostgreSQL and ClickHouse DAOs and supports:
- Writing to both databases simultaneously
- Reading from PostgreSQL (primary)
- Feature flag control for ClickHouse writes
"""

from typing import List, Optional
from uuid import UUID
import logging

from oss.src.core.tracing.interfaces import TracingDAOInterface
from oss.src.core.tracing.dtos import (
    OTelLink,
    OTelFlatSpan,
    TracingQuery,
    Bucket,
    MetricSpec,
    MetricsBucket,
)
from oss.src.dbs.postgres.tracing.dao import TracingDAO as PostgresTracingDAO
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

logger = get_module_logger(__name__)


class DualWriteTracingDAO(TracingDAOInterface):
    """
    Dual-write DAO that writes to both PostgreSQL and ClickHouse.

    - Reads from PostgreSQL (primary database)
    - Optionally writes to ClickHouse if enabled via USE_CLICKHOUSE flag
    """

    def __init__(self):
        self.postgres_dao = PostgresTracingDAO()
        self.use_clickhouse = env.USE_CLICKHOUSE

        # Lazily load ClickHouse DAO only if enabled
        self._clickhouse_dao = None

    @property
    def clickhouse_dao(self):
        """Lazily load ClickHouse DAO if USE_CLICKHOUSE is enabled."""
        if self._clickhouse_dao is None and self.use_clickhouse:
            try:
                from oss.src.dbs.clickhouse.tracing.dao import (
                    TracingDAO as ClickHouseTracingDAO,
                )
                from oss.src.dbs.clickhouse.shared.engine import engine

                # Check if ClickHouse is available
                self._clickhouse_dao = ClickHouseTracingDAO()
            except Exception as e:
                logger.warning(
                    f"Failed to load ClickHouse DAO: {e}. "
                    "Continuing with PostgreSQL only."
                )
                self.use_clickhouse = False
                self._clickhouse_dao = None

        return self._clickhouse_dao

    async def _write_to_clickhouse_async(
        self, operation_name: str, *args, **kwargs
    ) -> None:
        """
        Safely write to ClickHouse without blocking main operation.

        Errors are logged but don't fail the main operation.
        """
        if not self.use_clickhouse or self.clickhouse_dao is None:
            return

        try:
            # ClickHouse operations will be implemented later
            logger.debug(f"ClickHouse write operation: {operation_name}")
        except Exception as e:
            logger.warning(
                f"ClickHouse write operation failed ({operation_name}): {e}"
            )

    ### CRUD on spans

    async def create_span(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dto: OTelFlatSpan,
    ) -> Optional[OTelLink]:
        """Create a span in PostgreSQL and optionally in ClickHouse."""
        # Always write to PostgreSQL (primary)
        link = await self.postgres_dao.create_span(
            project_id=project_id,
            user_id=user_id,
            span_dto=span_dto,
        )

        # Optionally write to ClickHouse (fire and forget)
        if self.use_clickhouse and self.clickhouse_dao:
            self._write_to_clickhouse_async(
                "create_span",
                project_id=project_id,
                user_id=user_id,
                span_dto=span_dto,
            )

        return link

    async def create_spans(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dtos: List[OTelFlatSpan],
    ) -> List[OTelLink]:
        """Create spans in PostgreSQL and optionally in ClickHouse."""
        # Always write to PostgreSQL (primary)
        links = await self.postgres_dao.create_spans(
            project_id=project_id,
            user_id=user_id,
            span_dtos=span_dtos,
        )

        # Optionally write to ClickHouse (fire and forget)
        if self.use_clickhouse and self.clickhouse_dao:
            self._write_to_clickhouse_async(
                "create_spans",
                project_id=project_id,
                user_id=user_id,
                span_dtos=span_dtos,
            )

        return links

    async def read_span(
        self,
        *,
        project_id: UUID,
        #
        span_id: UUID,
    ) -> Optional[OTelFlatSpan]:
        """Read a span from PostgreSQL."""
        return await self.postgres_dao.read_span(
            project_id=project_id,
            span_id=span_id,
        )

    async def read_spans(
        self,
        *,
        project_id: UUID,
        #
        span_ids: List[UUID],
    ) -> List[OTelFlatSpan]:
        """Read spans from PostgreSQL."""
        return await self.postgres_dao.read_spans(
            project_id=project_id,
            span_ids=span_ids,
        )

    async def update_span(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dto: OTelFlatSpan,
    ) -> Optional[OTelLink]:
        """Update a span in PostgreSQL and optionally in ClickHouse."""
        # Always update in PostgreSQL (primary)
        link = await self.postgres_dao.update_span(
            project_id=project_id,
            user_id=user_id,
            span_dto=span_dto,
        )

        # Optionally update in ClickHouse (fire and forget)
        if self.use_clickhouse and self.clickhouse_dao:
            self._write_to_clickhouse_async(
                "update_span",
                project_id=project_id,
                user_id=user_id,
                span_dto=span_dto,
            )

        return link

    async def update_spans(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dtos: List[OTelFlatSpan],
    ) -> List[OTelLink]:
        """Update spans in PostgreSQL and optionally in ClickHouse."""
        # Always update in PostgreSQL (primary)
        links = await self.postgres_dao.update_spans(
            project_id=project_id,
            user_id=user_id,
            span_dtos=span_dtos,
        )

        # Optionally update in ClickHouse (fire and forget)
        if self.use_clickhouse and self.clickhouse_dao:
            self._write_to_clickhouse_async(
                "update_spans",
                project_id=project_id,
                user_id=user_id,
                span_dtos=span_dtos,
            )

        return links

    async def delete_span(
        self,
        *,
        project_id: UUID,
        #
        span_id: UUID,
    ) -> Optional[OTelLink]:
        """Delete a span from PostgreSQL and optionally from ClickHouse."""
        # Always delete from PostgreSQL (primary)
        link = await self.postgres_dao.delete_span(
            project_id=project_id,
            span_id=span_id,
        )

        # Optionally delete from ClickHouse (fire and forget)
        if self.use_clickhouse and self.clickhouse_dao:
            self._write_to_clickhouse_async(
                "delete_span",
                project_id=project_id,
                span_id=span_id,
            )

        return link

    async def delete_spans(
        self,
        *,
        project_id: UUID,
        #
        span_ids: List[UUID],
    ) -> List[OTelLink]:
        """Delete spans from PostgreSQL and optionally from ClickHouse."""
        # Always delete from PostgreSQL (primary)
        links = await self.postgres_dao.delete_spans(
            project_id=project_id,
            span_ids=span_ids,
        )

        # Optionally delete from ClickHouse (fire and forget)
        if self.use_clickhouse and self.clickhouse_dao:
            self._write_to_clickhouse_async(
                "delete_spans",
                project_id=project_id,
                span_ids=span_ids,
            )

        return links

    ### .R.D on traces

    async def read_trace(
        self,
        *,
        project_id: UUID,
        #
        trace_id: UUID,
    ) -> List[OTelFlatSpan]:
        """Read a trace from PostgreSQL."""
        return await self.postgres_dao.read_trace(
            project_id=project_id,
            trace_id=trace_id,
        )

    async def read_traces(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelFlatSpan]:
        """Read traces from PostgreSQL."""
        return await self.postgres_dao.read_traces(
            project_id=project_id,
            trace_ids=trace_ids,
        )

    async def delete_trace(
        self,
        *,
        project_id: UUID,
        #
        trace_id: UUID,
    ) -> List[OTelLink]:
        """Delete a trace from PostgreSQL and optionally from ClickHouse."""
        # Always delete from PostgreSQL (primary)
        links = await self.postgres_dao.delete_trace(
            project_id=project_id,
            trace_id=trace_id,
        )

        # Optionally delete from ClickHouse (fire and forget)
        if self.use_clickhouse and self.clickhouse_dao:
            self._write_to_clickhouse_async(
                "delete_trace",
                project_id=project_id,
                trace_id=trace_id,
            )

        return links

    async def delete_traces(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelLink]:
        """Delete traces from PostgreSQL and optionally from ClickHouse."""
        # Always delete from PostgreSQL (primary)
        links = await self.postgres_dao.delete_traces(
            project_id=project_id,
            trace_ids=trace_ids,
        )

        # Optionally delete from ClickHouse (fire and forget)
        if self.use_clickhouse and self.clickhouse_dao:
            self._write_to_clickhouse_async(
                "delete_traces",
                project_id=project_id,
                trace_ids=trace_ids,
            )

        return links

    ### QUERY

    async def query(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
    ) -> List[OTelFlatSpan]:
        """Query spans from PostgreSQL."""
        return await self.postgres_dao.query(
            project_id=project_id,
            query=query,
        )

    ### ANALYTICS

    async def legacy_analytics(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
    ) -> List[Bucket]:
        """Get legacy analytics from PostgreSQL."""
        return await self.postgres_dao.legacy_analytics(
            project_id=project_id,
            query=query,
        )

    async def analytics(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
        specs: List[MetricSpec],
    ) -> List[MetricsBucket]:
        """Get analytics from PostgreSQL."""
        return await self.postgres_dao.analytics(
            project_id=project_id,
            query=query,
            specs=specs,
        )
