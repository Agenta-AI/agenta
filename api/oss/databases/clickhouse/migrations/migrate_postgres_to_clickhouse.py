"""
Data migration script from PostgreSQL to ClickHouse.

This script migrates span and node data from PostgreSQL tracing database
to ClickHouse for improved analytical performance.

Usage:
    python -m oss.databases.clickhouse.migrations.migrate_postgres_to_clickhouse
"""

import asyncio
import json
from datetime import datetime
from typing import List, Dict, Any
from uuid import UUID

import logging

# PostgreSQL imports
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select

# ClickHouse imports
from oss.src.dbs.clickhouse.shared.engine import engine as clickhouse_engine
from oss.src.dbs.clickhouse.tracing.dao import TracingDAO, ObservabilityDAO
from oss.src.dbs.clickhouse.tracing.dbes import SpanCHE, NodeCHE

# PostgreSQL models
from oss.src.dbs.postgres.tracing.dbes import SpanDBE
from oss.src.dbs.postgres.observability.dbes import NodesDBE
from oss.src.utils.env import env

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def migrate_spans() -> int:
    """Migrate all spans from PostgreSQL to ClickHouse."""
    logger.info("Starting spans migration...")

    # Create PostgreSQL engine
    pg_engine = create_async_engine(
        url=env.POSTGRES_URI_TRACING,
        echo=False,
    )

    pg_session_maker = async_sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=pg_engine,
        expire_on_commit=False,
    )

    try:
        # Initialize ClickHouse tables
        await TracingDAO.init_tables()
        logger.info("ClickHouse tables initialized")

        # Batch size for processing
        batch_size = 1000
        offset = 0
        total_migrated = 0

        while True:
            async with pg_session_maker() as session:
                # Fetch batch of spans from PostgreSQL
                stmt = select(SpanDBE).limit(batch_size).offset(offset)
                result = await session.execute(stmt)
                pg_spans = result.scalars().all()

                if not pg_spans:
                    logger.info(f"No more spans to migrate. Total migrated: {total_migrated}")
                    break

                # Convert PostgreSQL spans to ClickHouse spans
                ch_spans = [_convert_pg_span_to_ch(span) for span in pg_spans]

                # Insert into ClickHouse
                await TracingDAO.create_spans(ch_spans)

                total_migrated += len(ch_spans)
                logger.info(
                    f"Migrated batch of {len(ch_spans)} spans. "
                    f"Total: {total_migrated}"
                )

                offset += batch_size

    finally:
        await pg_engine.dispose()

    return total_migrated


async def migrate_nodes() -> int:
    """Migrate all nodes from PostgreSQL to ClickHouse."""
    logger.info("Starting nodes migration...")

    # Create PostgreSQL engine
    pg_engine = create_async_engine(
        url=env.POSTGRES_URI_TRACING,
        echo=False,
    )

    pg_session_maker = async_sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=pg_engine,
        expire_on_commit=False,
    )

    try:
        # Batch size for processing
        batch_size = 1000
        offset = 0
        total_migrated = 0

        while True:
            async with pg_session_maker() as session:
                # Fetch batch of nodes from PostgreSQL
                stmt = select(NodesDBE).limit(batch_size).offset(offset)
                result = await session.execute(stmt)
                pg_nodes = result.scalars().all()

                if not pg_nodes:
                    logger.info(f"No more nodes to migrate. Total migrated: {total_migrated}")
                    break

                # Convert PostgreSQL nodes to ClickHouse nodes
                ch_nodes = [_convert_pg_node_to_ch(node) for node in pg_nodes]

                # Insert into ClickHouse
                await ObservabilityDAO.create_nodes(ch_nodes)

                total_migrated += len(ch_nodes)
                logger.info(
                    f"Migrated batch of {len(ch_nodes)} nodes. "
                    f"Total: {total_migrated}"
                )

                offset += batch_size

    finally:
        await pg_engine.dispose()

    return total_migrated


def _convert_pg_span_to_ch(pg_span) -> SpanCHE:
    """Convert a PostgreSQL span to a ClickHouse span."""
    return SpanCHE(
        project_id=str(pg_span.project_id),
        trace_id=str(pg_span.trace_id),
        span_id=str(pg_span.span_id),
        parent_id=str(pg_span.parent_id) if pg_span.parent_id else None,
        trace_type=pg_span.trace_type.value if pg_span.trace_type else None,
        span_type=pg_span.span_type.value if pg_span.span_type else None,
        span_kind=pg_span.span_kind.value if pg_span.span_kind else "UNSPECIFIED",
        span_name=pg_span.span_name or "",
        start_time=pg_span.start_time,
        end_time=pg_span.end_time,
        status_code=pg_span.status_code.value if pg_span.status_code else "UNSET",
        status_message=pg_span.status_message,
        attributes=json.dumps(pg_span.attributes) if pg_span.attributes else None,
        references=json.dumps(pg_span.references) if pg_span.references else None,
        links=json.dumps(pg_span.links) if pg_span.links else None,
        hashes=json.dumps(pg_span.hashes) if pg_span.hashes else None,
        events=json.dumps(pg_span.events) if pg_span.events else None,
        created_at=pg_span.created_at,
        updated_at=pg_span.updated_at,
        deleted_at=pg_span.deleted_at,
        created_by_id=str(pg_span.created_by_id) if pg_span.created_by_id else None,
        updated_by_id=str(pg_span.updated_by_id) if pg_span.updated_by_id else None,
        deleted_by_id=str(pg_span.deleted_by_id) if pg_span.deleted_by_id else None,
    )


def _convert_pg_node_to_ch(pg_node) -> NodeCHE:
    """Convert a PostgreSQL node to a ClickHouse node."""
    return NodeCHE(
        project_id=str(pg_node.project_id),
        node_id=str(pg_node.node_id),
        tree_id=str(pg_node.tree_id) if pg_node.tree_id else None,
        root_id=str(pg_node.root_id) if pg_node.root_id else None,
        created_at=pg_node.created_at,
        attributes=json.dumps(pg_node.attributes) if pg_node.attributes else None,
    )


async def main():
    """Run the full migration."""
    try:
        logger.info("Starting PostgreSQL to ClickHouse migration...")

        # Migrate spans
        spans_count = await migrate_spans()
        logger.info(f"Successfully migrated {spans_count} spans")

        # Migrate nodes
        nodes_count = await migrate_nodes()
        logger.info(f"Successfully migrated {nodes_count} nodes")

        logger.info("Migration completed successfully!")
        logger.info(f"Total spans migrated: {spans_count}")
        logger.info(f"Total nodes migrated: {nodes_count}")

    except Exception as e:
        logger.error(f"Migration failed: {str(e)}", exc_info=True)
        raise

    finally:
        await clickhouse_engine.close()


if __name__ == "__main__":
    asyncio.run(main())
