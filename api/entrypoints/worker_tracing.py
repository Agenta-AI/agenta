"""
Redis Streams workers for tracing spans ingestion.

Architecture:
- TracingWorker: Consumes from streams:otlp with high-throughput batching

Follows OTLP batching specs:
- Consumer groups for scalability (horizontal scaling)
- Batching & grouping by org/project/user (reduces DB contention)
- Layer 2 entitlements enforcement (authoritative quota checks)
- Two-tier caching for Layer 1 soft checks in router

Batch Configuration:
- max_batch_size: 50 (XREADGROUP COUNT) - max messages per read
- max_block_ms: 5000ms (XREADGROUP BLOCK) - max wait time when queue is empty
- max_batch_mb: 50 - max batch size in megabytes
- max_delay_ms: 250ms - max wait time for batch accumulation when small batches arrive

Performance Characteristics:
- At 1000 requests/sec: ~90 spans/sec ingestion
- With max_batch_size=50: spans grouped by (org, project, user)
- Response time: <5ms per XREADGROUP call
- DB operations: ~1 meter adjustment per org per second

Run with:
    python streams.py
"""

import sys
import asyncio
from redis.asyncio import Redis

from oss.src.utils.logging import get_module_logger
from oss.src.utils.helpers import warn_deprecated_env_vars, validate_required_env_vars
from oss.src.utils.env import env

from oss.src.dbs.postgres.tracing.dao import TracingDAO
from oss.src.core.tracing.service import TracingService

from oss.src.tasks.asyncio.tracing.worker import TracingWorker

log = get_module_logger(__name__)


async def main_async() -> int:
    """
    Main async entry point for tracing worker.

    Creates and runs TracingWorker for consuming from streams:otlp.

    Returns:
        Exit code (0 for success, non-zero for failure)
    """
    try:
        log.info("[OTLP] Initializing tracing worker")

        # Validate environment
        warn_deprecated_env_vars()
        validate_required_env_vars()

        # Create durable Redis client for streams
        redis_client = Redis.from_url(env.redis.uri_durable, decode_responses=False)

        # Initialize DAO
        tracing_dao = TracingDAO()

        # Initialize service
        tracing_service = TracingService(
            tracing_dao=tracing_dao,
        )

        # Initialize worker
        tracing_worker = TracingWorker(
            service=tracing_service,
            redis_client=redis_client,
            stream_name="streams:tracing",
            consumer_group="worker-tracing",
        )

        # Create consumer group (idempotent)
        await tracing_worker.create_consumer_group()

        log.info("[OTLP] Starting tracing worker")

        # Run worker
        await tracing_worker.run()

        return 0

    except Exception:
        log.error("[OTLP] Fatal error", exc_info=True)
        return 1


def main() -> int:
    """
    Main entry point for streams workers.

    Returns:
        Exit code (0 for success, non-zero for failure)
    """
    try:
        return asyncio.run(main_async())
    except KeyboardInterrupt:
        log.info("[OTLP] Shutdown requested")
        return 0
    except Exception:
        log.error("[OTLP] Fatal error", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
