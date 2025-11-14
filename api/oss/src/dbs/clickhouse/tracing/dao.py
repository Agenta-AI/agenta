"""
ClickHouse Data Access Object (DAO) for tracing operations.

This module provides CRUD operations for spans in ClickHouse.
"""

from typing import List, Dict, Any, Optional
from datetime import datetime
import json

from oss.src.dbs.clickhouse.shared.engine import engine
from oss.src.dbs.clickhouse.tracing.dbes import (
    SpanCHE,
    NodeCHE,
    CLICKHOUSE_SPANS_TABLE_DDL,
    CLICKHOUSE_NODES_TABLE_DDL,
)


class TracingDAO:
    """Data Access Object for ClickHouse tracing operations."""

    @staticmethod
    async def init_tables() -> None:
        """Initialize ClickHouse tables for tracing."""
        # Create spans table
        await engine.execute(CLICKHOUSE_SPANS_TABLE_DDL)
        # Create nodes table
        await engine.execute(CLICKHOUSE_NODES_TABLE_DDL)

    @staticmethod
    async def create_span(span: SpanCHE) -> None:
        """Create a single span in ClickHouse."""
        await engine.execute_insert("spans", [_span_to_dict(span)])

    @staticmethod
    async def create_spans(spans: List[SpanCHE]) -> None:
        """Create multiple spans in ClickHouse (batch insert)."""
        if not spans:
            return

        span_dicts = [_span_to_dict(span) for span in spans]
        await engine.execute_insert("spans", span_dicts)

    @staticmethod
    async def get_span_by_id(
        project_id: str, trace_id: str, span_id: str
    ) -> Optional[SpanCHE]:
        """Get a single span by project_id, trace_id, and span_id."""
        query = """
        SELECT *
        FROM spans
        WHERE project_id = %s AND trace_id = %s AND span_id = %s
        LIMIT 1
        """
        result = await engine.execute(
            query, [project_id, trace_id, span_id]
        )

        if result:
            return _dict_to_span(result[0])
        return None

    @staticmethod
    async def get_spans_by_trace_id(
        project_id: str, trace_id: str
    ) -> List[SpanCHE]:
        """Get all spans for a specific trace."""
        query = """
        SELECT *
        FROM spans
        WHERE project_id = %s AND trace_id = %s
        ORDER BY start_time ASC, span_id ASC
        """
        result = await engine.execute(query, [project_id, trace_id])

        return [_dict_to_span(row) for row in result]

    @staticmethod
    async def get_spans_by_project(
        project_id: str, limit: int = 100, offset: int = 0
    ) -> List[SpanCHE]:
        """Get spans for a project with pagination."""
        query = """
        SELECT *
        FROM spans
        WHERE project_id = %s
        ORDER BY created_at DESC
        LIMIT %s
        OFFSET %s
        """
        result = await engine.execute(
            query, [project_id, limit, offset]
        )

        return [_dict_to_span(row) for row in result]

    @staticmethod
    async def delete_span(
        project_id: str, trace_id: str, span_id: str
    ) -> None:
        """
        Soft delete a span by setting deleted_at timestamp.

        Since ClickHouse is append-only, we mark as deleted rather than remove.
        """
        update_query = """
        INSERT INTO spans
        SELECT *
        FROM spans
        WHERE project_id = %s AND trace_id = %s AND span_id = %s
        SETTINGS max_rows_in_set = 1000000
        """
        # For soft delete, we would typically use a ReplacingMergeTree version update
        # For now, we'll just mark it as deleted
        query = """
        ALTER TABLE spans UPDATE deleted_at = now()
        WHERE project_id = %s AND trace_id = %s AND span_id = %s
        """
        await engine.execute_delete(query)

    @staticmethod
    async def delete_trace(project_id: str, trace_id: str) -> None:
        """Soft delete all spans in a trace."""
        query = """
        ALTER TABLE spans UPDATE deleted_at = now()
        WHERE project_id = %s AND trace_id = %s
        """
        await engine.execute_delete(query)

    @staticmethod
    async def update_span(span: SpanCHE) -> None:
        """
        Update a span.

        For ClickHouse, we use a ReplacingMergeTree approach:
        insert the updated span with an incremented version.
        """
        # Since we're using MergeTree (not ReplacingMergeTree), we handle updates
        # by upserting the entire row
        await TracingDAO.create_span(span)

    @staticmethod
    async def search_spans(
        project_id: str,
        filters: Optional[Dict[str, Any]] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[SpanCHE]:
        """
        Search spans with optional filters.

        Filters can include:
        - trace_type: str
        - span_type: str
        - span_kind: str
        - status_code: str
        """
        query = "SELECT * FROM spans WHERE project_id = %s"
        params = [project_id]

        if filters:
            if "trace_type" in filters:
                query += " AND trace_type = %s"
                params.append(filters["trace_type"])

            if "span_type" in filters:
                query += " AND span_type = %s"
                params.append(filters["span_type"])

            if "span_kind" in filters:
                query += " AND span_kind = %s"
                params.append(filters["span_kind"])

            if "status_code" in filters:
                query += " AND status_code = %s"
                params.append(filters["status_code"])

        query += " ORDER BY created_at DESC LIMIT %s OFFSET %s"
        params.extend([limit, offset])

        result = await engine.execute(query, params)

        return [_dict_to_span(row) for row in result]


class ObservabilityDAO:
    """Data Access Object for ClickHouse observability operations."""

    @staticmethod
    async def create_node(node: NodeCHE) -> None:
        """Create a single node in ClickHouse."""
        await engine.execute_insert("nodes", [_node_to_dict(node)])

    @staticmethod
    async def create_nodes(nodes: List[NodeCHE]) -> None:
        """Create multiple nodes in ClickHouse (batch insert)."""
        if not nodes:
            return

        node_dicts = [_node_to_dict(node) for node in nodes]
        await engine.execute_insert("nodes", node_dicts)

    @staticmethod
    async def get_node(
        project_id: str, node_id: str
    ) -> Optional[NodeCHE]:
        """Get a single node by project_id and node_id."""
        query = """
        SELECT *
        FROM nodes
        WHERE project_id = %s AND node_id = %s
        LIMIT 1
        """
        result = await engine.execute(query, [project_id, node_id])

        if result:
            return _dict_to_node(result[0])
        return None

    @staticmethod
    async def get_nodes_by_project(
        project_id: str, limit: int = 100, offset: int = 0
    ) -> List[NodeCHE]:
        """Get nodes for a project with pagination."""
        query = """
        SELECT *
        FROM nodes
        WHERE project_id = %s
        ORDER BY created_at DESC
        LIMIT %s
        OFFSET %s
        """
        result = await engine.execute(
            query, [project_id, limit, offset]
        )

        return [_dict_to_node(row) for row in result]


# Helper functions to convert between ClickHouse tuples/dicts and entities


def _span_to_dict(span: SpanCHE) -> Dict[str, Any]:
    """Convert SpanCHE to a dictionary for ClickHouse insertion."""
    return {
        "project_id": span.project_id,
        "trace_id": span.trace_id,
        "span_id": span.span_id,
        "parent_id": span.parent_id,
        "trace_type": span.trace_type,
        "span_type": span.span_type,
        "span_kind": span.span_kind,
        "span_name": span.span_name,
        "start_time": span.start_time or datetime.now(),
        "end_time": span.end_time or datetime.now(),
        "status_code": span.status_code,
        "status_message": span.status_message,
        "attributes": span.attributes,
        "references": span.references,
        "links": span.links,
        "hashes": span.hashes,
        "events": span.events,
        "created_at": span.created_at or datetime.now(),
        "updated_at": span.updated_at,
        "deleted_at": span.deleted_at,
        "created_by_id": span.created_by_id,
        "updated_by_id": span.updated_by_id,
        "deleted_by_id": span.deleted_by_id,
    }


def _dict_to_span(data: tuple) -> SpanCHE:
    """Convert ClickHouse tuple result to SpanCHE entity."""
    # Column order matches the SELECT * query
    return SpanCHE(
        project_id=data[0],
        trace_id=data[1],
        span_id=data[2],
        parent_id=data[3],
        trace_type=data[4],
        span_type=data[5],
        span_kind=data[6],
        span_name=data[7],
        start_time=data[8],
        end_time=data[9],
        status_code=data[10],
        status_message=data[11],
        attributes=data[12],
        references=data[13],
        links=data[14],
        hashes=data[15],
        events=data[16],
        created_at=data[17],
        updated_at=data[18],
        deleted_at=data[19],
        created_by_id=data[20],
        updated_by_id=data[21],
        deleted_by_id=data[22],
    )


def _node_to_dict(node: NodeCHE) -> Dict[str, Any]:
    """Convert NodeCHE to a dictionary for ClickHouse insertion."""
    return {
        "project_id": node.project_id,
        "node_id": node.node_id,
        "tree_id": node.tree_id,
        "root_id": node.root_id,
        "created_at": node.created_at or datetime.now(),
        "attributes": node.attributes,
    }


def _dict_to_node(data: tuple) -> NodeCHE:
    """Convert ClickHouse tuple result to NodeCHE entity."""
    return NodeCHE(
        project_id=data[0],
        node_id=data[1],
        tree_id=data[2],
        root_id=data[3],
        created_at=data[4],
        attributes=data[5],
    )
