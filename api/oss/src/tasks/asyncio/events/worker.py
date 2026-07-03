import asyncio
import time
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple
from uuid import UUID

from redis.asyncio import Redis

from oss.src.core.events.service import EventsService
from oss.src.core.events.streaming import deserialize_event
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.tasks.asyncio.shared.consumer import StreamConsumer

log = get_module_logger(__name__)

if is_ee():
    from ee.src.core.access.entitlements.service import check_entitlements, scope_from
    from ee.src.core.access.entitlements.types import Counter

if TYPE_CHECKING:
    from oss.src.tasks.asyncio.webhooks.dispatcher import WebhooksDispatcher


class EventsWorker(StreamConsumer):
    """
    Worker for events ingestion via Redis Streams.

    Consumes from: streams:events
    Consumer group: worker-events

    Flow:
    1. Read batch from Redis Streams (XREADGROUP) — StreamConsumer
    2. Deserialize events from bytes
    3. Group by project_id
    4. Authoritative L2 quota per org (EE only):
       `Counter.EVENTS_INGESTED` — atomic adjust per org with the full
       per-org delta. Mirrors the tracing worker's
       `Counter.TRACES_INGESTED` pattern. Over-quota orgs are dropped.
    5. Ingest events per project if the org is within quota
    6. Dispatch to webhooks (if configured) — overridden `run()`, can skip ack
       to force redelivery on dispatch failure
    7. ACK + DEL messages — StreamConsumer
    """

    log_prefix = "[EVENTS]"

    def __init__(
        self,
        service: EventsService,
        redis_client: Redis,
        stream_name: str,
        consumer_group: str,
        consumer_name: Optional[str] = None,
        max_batch_size: int = 50,  # 50 events
        max_block_ms: int = 5000,  # 5 seconds
        max_delay_ms: int = 250,  # 250 milliseconds
        max_batch_mb: int = 50,  # 50 MB
        #
        webhooks_dispatcher: Optional["WebhooksDispatcher"] = None,
    ):
        super().__init__(
            redis_client=redis_client,
            stream_name=stream_name,
            consumer_group=consumer_group,
            consumer_name=consumer_name,
            max_batch_size=max_batch_size,
            max_block_ms=max_block_ms,
            max_delay_ms=max_delay_ms,
            max_batch_mb=max_batch_mb,
        )
        self.service = service
        self.webhooks_dispatcher = webhooks_dispatcher

    async def process_batch(
        self, batch: List[Tuple[bytes, Dict[bytes, bytes]]]
    ) -> Tuple[int, List[bytes], List[Dict[str, Any]]]:
        """
        Process batch of events grouped by project.

        Enforces byte size limit (max_batch_mb) and checks EE entitlements per org.

        Args:
            batch: List of (message_id, {b"data": serialized_event}) tuples

        Returns:
            Tuple of (total_ingested, processed_message_ids, project_batches)
        """
        groups: Dict[UUID, Dict[str, Any]] = {}
        processed_ids: List[bytes] = []
        batch_bytes = 0

        for msg_id, data in batch:
            try:
                payload = data[b"data"]

                batch_bytes += len(payload)
                if batch_bytes > self.max_batch_mb * 1024 * 1024:
                    break

                msg = deserialize_event(payload=payload)
                group = groups.get(msg.project_id)
                if group is None:
                    group = {
                        "organization_id": msg.organization_id,
                        "project_id": msg.project_id,
                        "events": [],
                    }
                    groups[msg.project_id] = group
                group["events"].append(msg)
                processed_ids.append(msg_id)
            except Exception:
                log.error(
                    "[EVENTS] Failed to deserialize message",
                    msg_id=repr(msg_id),
                    exc_info=True,
                )
                # Intentionally ACK unprocessable messages: a malformed message will
                # never succeed on retry, so keeping it in the PEL would block the
                # consumer indefinitely. Drop and log — wontfix by design.
                processed_ids.append(msg_id)

        batches = list(groups.values())
        total_ingested = 0
        allowed_batches = []

        # L2 `Counter.EVENTS_INGESTED` — authoritative usage meter charged
        # once per org with the full per-org delta in this batch. Mirrors
        # the tracing worker's per-org quota pattern.
        #
        # The "is the org entitled to the events feature at all?" question
        # is intentionally NOT enforced at ingest — retention (configured
        # per plan via `Counter.EVENTS_INGESTED.retention`) takes care of
        # plan-tier scoping, and `Flag.AUDIT` is enforced at the query side
        # (`POST /events/query`). Always-accept-at-ingest means an upgrade
        # makes historical events queryable immediately, without backfill.
        org_allowed: Dict[UUID, bool] = {}
        events_per_org: Dict[UUID, int] = {}

        if is_ee():
            for project_batch in batches:
                org_id = project_batch["organization_id"]
                if org_id is None:
                    continue
                events_per_org[org_id] = events_per_org.get(org_id, 0) + len(
                    project_batch["events"]
                )

            for org_id, delta in events_per_org.items():
                if delta <= 0:
                    org_allowed[org_id] = True
                    continue

                try:
                    # L2: authoritative counter check + adjust. Charge the
                    # full per-org delta in one call so the meter advances
                    # atomically.
                    quota_allowed, _, _ = await check_entitlements(  # type: ignore
                        key=Counter.EVENTS_INGESTED,  # type: ignore
                        delta=delta,
                        scope=scope_from(organization_id=org_id),  # type: ignore
                    )
                except Exception:
                    # On error, drop the org's events to stay conservative.
                    # Matches the tracing worker's safety stance.
                    log.error(
                        "[EVENTS] L2 quota check failed",
                        organization_id=str(org_id),
                        exc_info=True,
                    )
                    org_allowed[org_id] = False
                    continue

                if not quota_allowed:
                    log.warning(
                        "[EVENTS] Quota exceeded, dropping org batch",
                        organization_id=str(org_id),
                        delta=delta,
                    )
                    org_allowed[org_id] = False
                    continue

                org_allowed[org_id] = True

        for project_batch in batches:
            org_id = project_batch["organization_id"]
            if is_ee() and org_id and not org_allowed.get(org_id, True):
                continue

            if is_ee():
                total_ingested += await self.service.ingest(
                    project_id=project_batch["project_id"],
                    events=[msg.to_event() for msg in project_batch["events"]],
                )
            allowed_batches.append(project_batch)

        return total_ingested, processed_ids, allowed_batches

    async def run(self):
        """
        Main worker loop — overrides StreamConsumer.run to add the webhook-dispatch
        stage (the one asymmetry the base loop doesn't have).

        Flow:
        1. Read batch via XREADGROUP
        2. Process batch (returns ingested count, message IDs, project batches)
        3. Dispatch to webhooks (if configured) — skip ACK/DEL on failure to allow retry
        4. ACK + DEL processed messages
        5. On error, messages remain pending for retry
        """
        log.info(
            "[EVENTS] Worker started",
            stream=self.stream_name,
            group=self.consumer_group,
            consumer=self.consumer_name,
            max_batch_size=self.max_batch_size,
            webhooks=self.webhooks_dispatcher is not None,
        )

        while True:
            try:
                # 1. Read batch from stream (idle blocks return empty, never tick)
                read_started = time.perf_counter()
                batch = await self.read_batch()
                if not batch:
                    continue

                read_ms = (time.perf_counter() - read_started) * 1000
                started = time.perf_counter()

                # 2. Process batch
                ingested, processed_ids, batches = await self.process_batch(batch)

                # 3. Dispatch to webhooks (skip ACK/DEL on failure to allow retry)
                if self.webhooks_dispatcher and batches:
                    log.info(
                        "[EVENTS] Dispatching webhooks",
                        batches=len(batches),
                        dispatcher=type(self.webhooks_dispatcher).__name__,
                    )
                    try:
                        await self.webhooks_dispatcher.dispatch(batches=batches)
                    except Exception:
                        log.error("[EVENTS] Webhook dispatch failed", exc_info=True)
                        log.warning(
                            "[EVENTS] Skipping ACK/DEL due to webhook dispatch failure",
                            batch_size=len(batch),
                        )
                        log.tick(
                            f"{self.metric_stream}.errors",
                            dims={"stream": self.metric_stream},
                        )
                        continue
                else:
                    log.info(
                        "[EVENTS] Skipping webhook dispatch",
                        has_dispatcher=self.webhooks_dispatcher is not None,
                        batches=len(batches),
                    )

                # 4. ACK and DELETE processed messages
                await self.ack_and_delete(processed_ids)
                log.info(
                    "[EVENTS] Batch processed",
                    batch_size=len(batch),
                    ingested=ingested,
                )
                log.tick(
                    f"{self.metric_stream}.processed",
                    count=len(processed_ids),
                    duration_ms=(time.perf_counter() - started) * 1000,
                    read_ms=read_ms,
                    dims={"stream": self.metric_stream},
                )
            except Exception:
                log.error("[EVENTS] Worker loop error", exc_info=True)
                log.tick(
                    f"{self.metric_stream}.errors", dims={"stream": self.metric_stream}
                )
                await asyncio.sleep(1)
