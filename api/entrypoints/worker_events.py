import sys
import asyncio

from redis.asyncio import Redis
from taskiq_redis import RedisStreamBroker

from oss.src.core.events.service import EventsService
from oss.src.dbs.postgres.events.dao import EventsDAO
from oss.src.dbs.postgres.webhooks.dao import WebhooksDAO
from oss.src.tasks.asyncio.events.worker import EventsWorker
from oss.src.tasks.asyncio.webhooks.dispatcher import WebhooksDispatcher
from oss.src.tasks.taskiq.webhooks.worker import WebhooksWorker
from oss.src.utils.env import env
from oss.src.utils.helpers import warn_deprecated_env_vars, validate_required_env_vars
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


async def main_async() -> int:
    try:
        warn_deprecated_env_vars()
        validate_required_env_vars()

        redis_client = Redis.from_url(env.redis.uri_durable, decode_responses=False)

        # --- events ingestion ---
        events_dao = EventsDAO()
        events_service = EventsService(events_dao=events_dao)

        # --- webhooks dispatcher (parenthesis inside the events loop) ---
        webhooks_dao = WebhooksDAO()

        broker = RedisStreamBroker(
            url=env.redis.uri_durable,
            queue_name="queues:webhooks",
            consumer_group_name="worker-events-webhooks-dispatcher",
        )
        await broker.startup()

        webhooks_worker = WebhooksWorker(
            broker=broker,
            webhooks_dao=webhooks_dao,
        )

        webhooks_dispatcher = WebhooksDispatcher(
            subscriptions_dao=webhooks_dao,
            deliver_task=webhooks_worker.deliver_webhook,
        )

        # --- wire together ---
        worker = EventsWorker(
            service=events_service,
            redis_client=redis_client,
            stream_name="streams:events",
            consumer_group="worker-events",
            webhooks_dispatcher=webhooks_dispatcher,
        )

        await worker.create_consumer_group()
        await worker.run()
        return 0
    except Exception:
        log.error("[EVENTS] Fatal error", exc_info=True)
        return 1


def main() -> int:
    try:
        return asyncio.run(main_async())
    except KeyboardInterrupt:
        log.info("[EVENTS] Shutdown requested")
        return 0
    except Exception:
        log.error("[EVENTS] Fatal error", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
