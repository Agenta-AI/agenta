import sys
import asyncio

from redis.asyncio import Redis

from oss.src.core.transcripts.service import TranscriptsService
from oss.src.dbs.postgres.transcripts.dao import TranscriptsDAO
from oss.src.tasks.asyncio.transcripts.worker import TranscriptsWorker
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

        transcripts_dao = TranscriptsDAO()
        transcripts_service = TranscriptsService(transcripts_dao=transcripts_dao)

        worker = TranscriptsWorker(
            service=transcripts_service,
            redis_client=redis_client,
            stream_name="streams:transcripts",
            consumer_group="worker-transcripts",
        )

        await worker.create_consumer_group()
        await worker.run()
        return 0
    except Exception:
        log.error("[TRANSCRIPTS] Fatal error", exc_info=True)
        return 1


def main() -> int:
    try:
        return asyncio.run(main_async())
    except KeyboardInterrupt:
        log.info("[TRANSCRIPTS] Shutdown requested")
        return 0
    except Exception:
        log.error("[TRANSCRIPTS] Fatal error", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
