"""
Redis Streams workers for tracing spans ingestion.

Replaces asyncio.Queue workers from PR #1223 with persistent Redis Streams.

Architecture:
- TracingWorker: Consumes from streams:otlp

Follows OTLP batching specs:
- Consumer groups for scalability
- Batching & grouping by org/project/user
- Layer 2 entitlements enforcement (authoritative)

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
        log.info("[Streams] Initializing tracing worker")

        # Validate environment
        warn_deprecated_env_vars()
        validate_required_env_vars()

        # Create durable Redis client for streams
        redis_client = Redis.from_url(env.REDIS_STREAM_URL, decode_responses=False)

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
            stream_name="streams:otlp",
            consumer_group="otlp-workers",
            batch_size=100,  # From OTLP specs: max 1000, but 100 is good default
            block_ms=5000,  # 5s block time
        )

        # Create consumer group (idempotent)
        await tracing_worker.create_consumer_group()

        log.info("[Streams] Starting tracing worker")

        # Run worker
        await tracing_worker.run()

        return 0

    except Exception as e:
        log.error("[Streams] Fatal error", error=str(e), exc_info=True)
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
        log.info("[Streams] Shutdown requested")
        return 0
    except Exception as e:
        log.error("[Streams] Fatal error", error=str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
