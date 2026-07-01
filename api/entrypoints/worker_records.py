import sys
import asyncio

from redis.asyncio import Redis

from oss.src.core.sessions.records.service import RecordsService
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
from oss.src.tasks.asyncio.sessions.records_worker import RecordsWorker
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.src.utils.helpers import warn_deprecated_env_vars, validate_required_env_vars
from oss.src.utils.logging import get_module_logger

if is_ee():
    from ee.src.core.access.entitlements.service import bootstrap_entitlements_services

log = get_module_logger(__name__)


async def main_async() -> int:
    try:
        warn_deprecated_env_vars()
        validate_required_env_vars()

        if is_ee():
            bootstrap_entitlements_services()

        redis_client = Redis.from_url(env.redis.uri_durable, decode_responses=False)

        records_dao = RecordsDAO()
        records_service = RecordsService(records_dao=records_dao)

        worker = RecordsWorker(
            service=records_service,
            redis_client=redis_client,
            stream_name="streams:records",
            consumer_group="worker-records",
        )

        await worker.create_consumer_group()
        await worker.run()
        return 0
    except Exception:
        log.error("[RECORDS] Fatal error", exc_info=True)
        return 1


def main() -> int:
    try:
        return asyncio.run(main_async())
    except KeyboardInterrupt:
        log.info("[RECORDS] Shutdown requested")
        return 0
    except Exception:
        log.error("[RECORDS] Fatal error", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
