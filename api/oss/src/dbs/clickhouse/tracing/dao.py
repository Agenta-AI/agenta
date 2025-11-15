"""
ClickHouse Data Access Object (DAO) for tracing operations.

This module provides CRUD operations for spans in ClickHouse,
implementing the TracingDAOInterface.
"""

from typing import List, Dict, Any, Optional
from uuid import UUID
from datetime import datetime, timezone

from oss.src.core.tracing.interfaces import TracingDAOInterface
from oss.src.core.tracing.dtos import (
    OTelLink,
    OTelFlatSpan,
    TracingQuery,
    Bucket,
    MetricSpec,
    MetricsBucket,
)
from oss.src.dbs.clickhouse.shared.engine import engine
from oss.src.dbs.clickhouse.tracing.dbes import (
    CLICKHOUSE_SPANS_TABLE_DDL,
    CLICKHOUSE_NODES_TABLE_DDL,
)
from oss.src.utils.logging import get_module_logger

logger = get_module_logger(__name__)


class TracingDAO(TracingDAOInterface):
    """Data Access Object for ClickHouse tracing operations."""

    def __init__(self):
        """Initialize ClickHouse TracingDAO."""
        # Override the interface's __init__ which raises NotImplementedError
        pass

    async def create_tables(self) -> None:
        """Initialize ClickHouse tables for tracing."""
        try:
            await engine.execute(CLICKHOUSE_SPANS_TABLE_DDL)
            await engine.execute(CLICKHOUSE_NODES_TABLE_DDL)
            logger.info("ClickHouse tracing tables created successfully")
        except Exception as e:
            logger.error(f"Failed to create ClickHouse tracing tables: {e}")
            raise

    ### CRUD on spans

    async def create_span(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dto: OTelFlatSpan,
    ) -> Optional[OTelLink]:
        """Create a single span in ClickHouse."""
        try:
            span_dict = _span_dto_to_dict(
                project_id=project_id,
                user_id=user_id,
                span_dto=span_dto,
            )
            await engine.execute_insert("spans", [span_dict])

            # Return link
            return OTelLink(
                trace_id=span_dto.trace_id,
                span_id=span_dto.span_id,
            )
        except Exception as e:
            logger.error(f"Failed to create span in ClickHouse: {e}")
            return None

    async def create_spans(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dtos: List[OTelFlatSpan],
    ) -> List[OTelLink]:
        """Create multiple spans in ClickHouse (batch insert)."""
        if not span_dtos:
            return []

        try:
            span_dicts = [
                _span_dto_to_dict(
                    project_id=project_id,
                    user_id=user_id,
                    span_dto=span_dto,
                )
                for span_dto in span_dtos
            ]
            await engine.execute_insert("spans", span_dicts)

            # Return links
            return [
                OTelLink(
                    trace_id=span_dto.trace_id,
                    span_id=span_dto.span_id,
                )
                for span_dto in span_dtos
            ]
        except Exception as e:
            logger.error(f"Failed to create spans in ClickHouse: {e}")
            return []

    async def read_span(
        self,
        *,
        project_id: UUID,
        #
        span_id: UUID,
    ) -> Optional[OTelFlatSpan]:
        """Read a span from ClickHouse."""
        # Note: ClickHouse is not optimized for single-row lookups
        # This is primarily for compatibility with the interface
        logger.warning("read_span called on ClickHouse - this operation is not optimized")
        return None

    async def read_spans(
        self,
        *,
        project_id: UUID,
        #
        span_ids: List[UUID],
    ) -> List[OTelFlatSpan]:
        """Read spans from ClickHouse."""
        logger.warning("read_spans called on ClickHouse - this operation is not optimized")
        return []

    async def update_span(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dto: OTelFlatSpan,
    ) -> Optional[OTelLink]:
        """Update a span in ClickHouse."""
        # For ClickHouse, updates are treated as inserts (append-only)
        return await self.create_span(
            project_id=project_id,
            user_id=user_id,
            span_dto=span_dto,
        )

    async def update_spans(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dtos: List[OTelFlatSpan],
    ) -> List[OTelLink]:
        """Update spans in ClickHouse."""
        # For ClickHouse, updates are treated as inserts (append-only)
        return await self.create_spans(
            project_id=project_id,
            user_id=user_id,
            span_dtos=span_dtos,
        )

    async def delete_span(
        self,
        *,
        project_id: UUID,
        #
        span_id: UUID,
    ) -> Optional[OTelLink]:
        """Delete a span from ClickHouse."""
        # Soft delete by marking deleted_at
        try:
            query = """
            ALTER TABLE spans UPDATE deleted_at = now()
            WHERE project_id = %(project_id)s AND span_id = %(span_id)s
            """
            await engine.execute_delete(query)
            return OTelLink(
                trace_id="",  # We don't have trace_id without a read
                span_id=str(span_id),
            )
        except Exception as e:
            logger.error(f"Failed to delete span in ClickHouse: {e}")
            return None

    async def delete_spans(
        self,
        *,
        project_id: UUID,
        #
        span_ids: List[UUID],
    ) -> List[OTelLink]:
        """Delete spans from ClickHouse."""
        # Soft delete by marking deleted_at
        try:
            query = """
            ALTER TABLE spans UPDATE deleted_at = now()
            WHERE project_id = %(project_id)s AND span_id IN %(span_ids)s
            """
            params = {
                "project_id": str(project_id),
                "span_ids": [str(sid) for sid in span_ids],
            }
            await engine.execute_delete(query)
            return [
                OTelLink(trace_id="", span_id=str(sid))
                for sid in span_ids
            ]
        except Exception as e:
            logger.error(f"Failed to delete spans in ClickHouse: {e}")
            return []

    ### .R.D on traces

    async def read_trace(
        self,
        *,
        project_id: UUID,
        #
        trace_id: UUID,
    ) -> List[OTelFlatSpan]:
        """Read a trace from ClickHouse."""
        logger.warning("read_trace called on ClickHouse - this operation is not optimized")
        return []

    async def read_traces(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelFlatSpan]:
        """Read traces from ClickHouse."""
        logger.warning("read_traces called on ClickHouse - this operation is not optimized")
        return []

    async def delete_trace(
        self,
        *,
        project_id: UUID,
        #
        trace_id: UUID,
    ) -> List[OTelLink]:
        """Delete a trace from ClickHouse."""
        try:
            query = """
            ALTER TABLE spans UPDATE deleted_at = now()
            WHERE project_id = %(project_id)s AND trace_id = %(trace_id)s
            """
            params = {
                "project_id": str(project_id),
                "trace_id": str(trace_id),
            }
            await engine.execute_delete(query)
            return []
        except Exception as e:
            logger.error(f"Failed to delete trace in ClickHouse: {e}")
            return []

    async def delete_traces(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelLink]:
        """Delete traces from ClickHouse."""
        try:
            query = """
            ALTER TABLE spans UPDATE deleted_at = now()
            WHERE project_id = %(project_id)s AND trace_id IN %(trace_ids)s
            """
            params = {
                "project_id": str(project_id),
                "trace_ids": [str(tid) for tid in trace_ids],
            }
            await engine.execute_delete(query)
            return []
        except Exception as e:
            logger.error(f"Failed to delete traces in ClickHouse: {e}")
            return []

    ### QUERY

    async def query(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
    ) -> List[OTelFlatSpan]:
        """Query spans from ClickHouse."""
        # TODO: Implement full query support for ClickHouse
        logger.warning("query() not yet fully implemented for ClickHouse")
        return []

    ### ANALYTICS

    async def legacy_analytics(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
    ) -> List[Bucket]:
        """Get legacy analytics from ClickHouse."""
        # TODO: Implement analytics for ClickHouse
        logger.warning("legacy_analytics() not yet fully implemented for ClickHouse")
        return []

    async def analytics(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
        specs: List[MetricSpec],
    ) -> List[MetricsBucket]:
        """Get analytics from ClickHouse."""
        # TODO: Implement analytics for ClickHouse
        logger.warning("analytics() not yet fully implemented for ClickHouse")
        return []


# Helper functions


def _span_dto_to_dict(
    *,
    project_id: UUID,
    user_id: UUID,
    span_dto: OTelFlatSpan,
) -> Dict[str, Any]:
    """Convert OTelFlatSpan DTO to dictionary for ClickHouse insertion."""
    now = datetime.now(timezone.utc)

    # Helper to convert enum/object to string
    def to_str(value):
        if value is None:
            return ""
        if hasattr(value, "value"):  # Enum
            return str(value.value)
        return str(value)

    return {
        "project_id": str(project_id),
        "trace_id": span_dto.trace_id or "",
        "span_id": span_dto.span_id or "",
        "parent_id": span_dto.parent_id or "",
        "trace_type": to_str(span_dto.trace_type),
        "span_type": to_str(span_dto.span_type),
        "span_kind": to_str(span_dto.span_kind),
        "span_name": span_dto.span_name or "",
        "start_time": span_dto.start_time or now,
        "end_time": span_dto.end_time or now,
        "status_code": to_str(span_dto.status_code),
        "status_message": span_dto.status_message or "",
        "attributes": span_dto.attributes or {},
        "references": span_dto.references or [],
        "links": span_dto.links or [],
        "hashes": span_dto.hashes or [],
        "events": span_dto.events or [],
        "created_at": now,
        "updated_at": None,
        "deleted_at": None,
        "created_by_id": str(user_id),
        "updated_by_id": None,
        "deleted_by_id": None,
    }
