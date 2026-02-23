import sys
import asyncio

from redis.asyncio import Redis

from oss.src.core.events.queue import EVENTS_STREAM_NAME, EVENTS_CONSUMER_GROUP
from oss.src.core.events.service import EventsService
from oss.src.dbs.postgres.events.dao import EventsDAO
from oss.src.tasks.asyncio.events.worker import EventsWorker
from oss.src.utils.env import env
from oss.src.utils.helpers import warn_deprecated_env_vars, validate_required_env_vars
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


async def main_async() -> int:
    try:
        warn_deprecated_env_vars()
        validate_required_env_vars()

        redis_client = Redis.from_url(env.redis.uri_durable, decode_responses=False)
        events_dao = EventsDAO()
        events_service = EventsService(events_dao=events_dao)
        worker = EventsWorker(
            service=events_service,
            redis_client=redis_client,
            stream_name=EVENTS_STREAM_NAME,
            consumer_group=EVENTS_CONSUMER_GROUP,
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
