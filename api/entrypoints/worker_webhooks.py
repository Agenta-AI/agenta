import sys

from taskiq.cli.worker.run import run_worker
from taskiq.cli.worker.args import WorkerArgs
from taskiq_redis import RedisStreamBroker

from oss.src.utils.logging import get_module_logger
from oss.src.utils.helpers import warn_deprecated_env_vars, validate_required_env_vars
from oss.src.utils.env import env

from oss.src.dbs.postgres.webhooks.dao import WebhooksDAO
from oss.src.tasks.taskiq.webhooks.worker import WebhooksWorker

import agenta as ag

log = get_module_logger(__name__)

# Initialize Agenta SDK
ag.init(
    api_url=env.agenta.api_url,
)

# BROKER -------------------------------------------------------------------
broker = RedisStreamBroker(
    url=env.redis.uri_durable,
    queue_name="queues:webhooks",
    consumer_group_name="worker-webhooks",
    # Use defaults for timeout as webhooks are short
)


# WORKERS ------------------------------------------------------------------
webhooks_dao = WebhooksDAO()

webhooks_worker = WebhooksWorker(
    broker=broker,
    webhooks_dao=webhooks_dao,
)


def main() -> int:
    """
    Main entry point for the worker.

    Returns:
        Exit code (0 for success, non-zero for failure)
    """
    try:
        log.info("[WEBHOOKS] Initializing Taskiq worker")

        # Validate environment
        warn_deprecated_env_vars()
        validate_required_env_vars()

        log.info("[WEBHOOKS] Starting Taskiq worker with Redis Streams")

        # Run Taskiq worker
        args = WorkerArgs(
            broker="entrypoints.worker_webhooks:broker",  # Reference broker from this module
            modules=[],
            fs_discover=False,
            workers=1,
            max_async_tasks=50,  # High concurrency for webhooks
        )

        result = run_worker(args)
        return result if result is not None else 0

    except KeyboardInterrupt:
        log.info("[WEBHOOKS] Shutdown requested")
        return 0
    except Exception as e:
        log.error("[WEBHOOKS] Fatal error", error=str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
