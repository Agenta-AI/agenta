"""
worker_streams - list-parameterized entrypoint hosting the stream consumer
loops (records, events, tracing) in one process.

Reads AGENTA_WORKER_STREAMS (subset of {records, events, tracing}); empty or
unset selects all three. Each selected loop keeps its own stream name,
consumer group, and StreamConsumer subclass unchanged (see
oss/src/tasks/asyncio/shared/consumer.py) — this entrypoint only decides which
loops share this process, via asyncio.gather.

The 7 single-loop entrypoints (worker_tracing.py, worker_records.py,
worker_events.py, ...) are untouched and remain valid; nothing external is
required to move off them.
"""

import sys
import asyncio
from typing import List

from redis.asyncio import Redis
from taskiq_redis import RedisStreamBroker

from oss.src.core.events.service import EventsService
from oss.src.core.secrets.services import VaultService
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.tracing.service import TracingService
from oss.src.dbs.postgres.events.dao import EventsDAO
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
from oss.src.dbs.postgres.tracing.dao import TracingDAO
from oss.src.dbs.postgres.webhooks.dao import WebhooksDAO
from oss.src.tasks.asyncio.events.worker import EventsWorker
from oss.src.tasks.asyncio.sessions.records_worker import RecordsWorker
from oss.src.tasks.asyncio.shared.consumer import StreamConsumer
from oss.src.tasks.asyncio.tracing.worker import TracingWorker
from oss.src.tasks.asyncio.webhooks.dispatcher import WebhooksDispatcher
from oss.src.tasks.taskiq.webhooks.worker import WebhooksWorker
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.src.utils.helpers import warn_deprecated_env_vars, validate_required_env_vars
from oss.src.utils.logging import get_module_logger

# Guard EE imports — see worker_tracing.py for the rationale.
if is_ee():
    from ee.src.core.access.entitlements.service import bootstrap_entitlements_services

log = get_module_logger(__name__)

ALL_STREAMS = ("records", "events", "tracing")

# Bound the stream so acked entries are trimmed; without this it grows unbounded.
MAXLEN_QUEUES_WEBHOOKS = 100_000


def _selected_streams() -> List[str]:
    selected = env.agenta.workers.streams
    if not selected:
        return list(ALL_STREAMS)
    unknown = set(selected) - set(ALL_STREAMS)
    if unknown:
        raise ValueError(
            f"AGENTA_WORKER_STREAMS has unknown entries: {sorted(unknown)}; "
            f"expected a subset of {ALL_STREAMS}"
        )
    return selected


async def _build_tracing_worker(redis_client: Redis) -> StreamConsumer:
    return TracingWorker(
        service=TracingService(tracing_dao=TracingDAO()),
        redis_client=redis_client,
        stream_name="streams:tracing",
        consumer_group="worker-tracing",
    )


async def _build_records_worker(redis_client: Redis) -> StreamConsumer:
    return RecordsWorker(
        service=RecordsService(records_dao=RecordsDAO()),
        redis_client=redis_client,
        stream_name="streams:records",
        consumer_group="worker-records",
    )


async def _build_events_worker(redis_client: Redis) -> StreamConsumer:
    events_service = EventsService(events_dao=EventsDAO())

    # Webhook dispatch is embedded in the events loop today (worker_events.py);
    # preserve that wiring so events keeps its post-hook.
    webhooks_dao = WebhooksDAO()
    broker = RedisStreamBroker(
        url=env.redis.uri_durable,
        queue_name="queues:webhooks",
        consumer_group_name="worker-events-webhooks-dispatcher",
        maxlen=MAXLEN_QUEUES_WEBHOOKS,
        approximate=True,
    )
    await broker.startup()

    webhooks_worker = WebhooksWorker(broker=broker, webhooks_dao=webhooks_dao)
    vault_service = VaultService(secrets_dao=SecretsDAO())
    webhooks_dispatcher = WebhooksDispatcher(
        subscriptions_dao=webhooks_dao,
        vault_service=vault_service,
        deliver_task=webhooks_worker.deliver_webhook,
    )

    return EventsWorker(
        service=events_service,
        redis_client=redis_client,
        stream_name="streams:events",
        consumer_group="worker-events",
        webhooks_dispatcher=webhooks_dispatcher,
    )


async def main_async() -> int:
    try:
        streams = _selected_streams()
        log.info("[STREAMS] Initializing worker-streams", selected=streams)

        warn_deprecated_env_vars()
        validate_required_env_vars()

        if is_ee():
            bootstrap_entitlements_services()

        redis_client = Redis.from_url(env.redis.uri_durable, decode_responses=False)

        builders = {
            "tracing": _build_tracing_worker,
            "records": _build_records_worker,
            "events": _build_events_worker,
        }

        consumers: List[StreamConsumer] = [
            await builders[name](redis_client) for name in streams
        ]

        for consumer in consumers:
            await consumer.create_consumer_group()

        log.info("[STREAMS] Starting worker-streams", selected=streams)

        await asyncio.gather(*(consumer.run() for consumer in consumers))

        return 0

    except Exception:
        log.error("[STREAMS] Fatal error", exc_info=True)
        return 1


def main() -> int:
    try:
        return asyncio.run(main_async())
    except KeyboardInterrupt:
        log.info("[STREAMS] Shutdown requested")
        return 0
    except Exception:
        log.error("[STREAMS] Fatal error", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
