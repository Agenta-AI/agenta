"""
TracingWorker - consumes from streams:otlp.

Replaces the in-memory asyncio.Queue worker from PR #1223 with Redis Streams.
Keeps the same batching, grouping, and entitlements logic.
"""

import asyncio
from typing import Dict, List, Set, Tuple, Optional
from uuid import UUID
from redis.asyncio import Redis

from oss.src.core.tracing.service import TracingService
from oss.src.core.tracing.totals import (
    TraceKey,
    claim_due_trace_totals,
    requeue_trace_totals,
    schedule_trace_totals,
)
from oss.src.utils.env import env
from oss.src.core.tracing.dtos import OTelFlatSpan
from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee
from oss.src.core.tracing.streaming import deserialize_span
from oss.src.tasks.asyncio.shared.consumer import StreamConsumer

log = get_module_logger(__name__)

#: Most traces kept in memory for a later try when scheduling their totals fails.
MAX_UNSCHEDULED_TRACES = 10_000

if is_ee():
    from ee.src.core.access.entitlements.service import (
        check_entitlements,
        scope_from,
        Counter,
    )


class TracingWorker(StreamConsumer):
    """
    Worker for tracing spans ingestion via Redis Streams.

    Consumes from: streams:spans
    Consumer group: worker-spans

    Flow:
    1. Read batch from Redis Streams (XREADGROUP) — StreamConsumer
    2. Deserialize spans from bytes
    3. Group by organization_id → (project_id, user_id)
    4. Check entitlements per org (Layer 2 - authoritative)
    5. Bulk create spans per project/user if allowed
    6. Schedule a totals recompute for traces split across requests
    7. ACK + DEL messages — StreamConsumer

    A second loop in `run` recomputes the scheduled traces once they are due.
    """

    log_prefix = "[INGEST]"

    def __init__(
        self,
        service: TracingService,
        redis_client: Redis,
        stream_name: str,
        consumer_group: str,
        consumer_name: Optional[str] = None,
        max_batch_size: int = 50,  # 50 spans
        max_block_ms: int = 5000,  # 5 seconds
        max_delay_ms: int = 250,  # 250 milliseconds
        max_batch_mb: int = 50,  # 50 MB
        totals_delay_ms: Optional[int] = None,
        totals_poll_s: float = 1.0,
        totals_batch_size: int = 50,
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
        self.totals_delay_ms = (
            env.agenta.otlp.totals_delay_ms
            if totals_delay_ms is None
            else totals_delay_ms
        )
        self.totals_poll_s = totals_poll_s
        self.totals_batch_size = totals_batch_size
        #: Traces whose totals scheduling failed; tried again on the next call.
        self.unscheduled_totals: Dict[TraceKey, Set[str]] = {}
        # Failed recomputes whose requeue also failed; the next loop requeues them.
        self.unrequeued_totals: Set[TraceKey] = set()

    async def run(self):
        await asyncio.gather(super().run(), self.run_totals())

    async def run_totals(self):
        while True:
            if self.unscheduled_totals:
                await self.schedule_totals({})
            if self.unrequeued_totals:
                await self.requeue_totals([])
            try:
                recomputed = await self.recompute_due_totals()
            except Exception:
                log.error("[INGEST] Error in trace totals loop", exc_info=True)
                recomputed = 0

            if recomputed < self.totals_batch_size:
                await asyncio.sleep(self.totals_poll_s)

    async def recompute_due_totals(self) -> int:
        trace_keys = await claim_due_trace_totals(
            self.redis, limit=self.totals_batch_size
        )

        failed: List[TraceKey] = []
        for project_id, trace_id in trace_keys:
            try:
                await self.service.recompute_trace_totals(
                    project_id=project_id,
                    trace_id=trace_id,
                )
            except Exception:
                log.error(
                    "[INGEST] Failed to recompute trace totals",
                    project_id=str(project_id),
                    trace_id=str(trace_id),
                    exc_info=True,
                )
                failed.append((project_id, trace_id))

        if failed:
            # The claim removed these traces from the queue; put them back for a later try.
            await self.requeue_totals(failed)

        return len(trace_keys)

    async def requeue_totals(self, trace_keys: List[TraceKey]):
        """Requeue failed traces. If Redis fails, keep them in memory for the next loop."""
        pending = self.unrequeued_totals
        pending.update(trace_keys)
        if not pending:
            return

        self.unrequeued_totals = set()
        try:
            await requeue_trace_totals(
                self.redis,
                trace_keys=list(pending),
                delay_ms=self.totals_delay_ms,
            )
        except Exception:
            log.error(
                "[INGEST] Failed to requeue trace totals",
                count=len(pending),
                exc_info=True,
            )
            if len(pending) > MAX_UNSCHEDULED_TRACES:
                log.error(
                    "[INGEST] Dropping unrequeued trace totals",
                    count=len(pending) - MAX_UNSCHEDULED_TRACES,
                )
                pending = set(list(pending)[:MAX_UNSCHEDULED_TRACES])
            self.unrequeued_totals.update(pending)

    async def schedule_totals(self, batches_by_trace: Dict[TraceKey, Set[str]]):
        """Schedule totals without failing the batch.

        The spans are already stored and metered, so a Redis error here must not stop the
        ACK: a redelivered batch would meter its traces again. The traces stay in memory
        instead, and the next call (next batch or the totals loop) tries them again.
        """
        pending = self.unscheduled_totals
        for key, batch_ids in batches_by_trace.items():
            pending.setdefault(key, set()).update(batch_ids)
        if not pending:
            return

        self.unscheduled_totals = {}
        try:
            await schedule_trace_totals(
                self.redis,
                batches_by_trace=pending,
                delay_ms=self.totals_delay_ms,
            )
        except Exception:
            log.error(
                "[INGEST] Failed to schedule trace totals",
                count=len(pending),
                exc_info=True,
            )
            if len(pending) > MAX_UNSCHEDULED_TRACES:
                log.error(
                    "[INGEST] Dropping unscheduled trace totals",
                    count=len(pending) - MAX_UNSCHEDULED_TRACES,
                )
                pending = dict(list(pending.items())[-MAX_UNSCHEDULED_TRACES:])
            for key, batch_ids in pending.items():
                self.unscheduled_totals.setdefault(key, set()).update(batch_ids)

    async def process_batch(
        self, batch: List[Tuple[bytes, Dict[bytes, bytes]]]
    ) -> Tuple[int, List[bytes]]:
        """
        Process batch of tracing spans with dual-limit enforcement.

        Enforces both span count (100 max) and configurable byte size limits.
        Stops processing when hitting either limit and leaves remaining
        messages for next batch processing.

        Args:
            batch: List of (message_id, {b"data": serialized_span}) tuples

        Returns:
            Tuple of (processed_count, processed_message_ids) for ACK/DEL
        """
        # Group spans by org → (project, user) (same as PR #1223)
        spans_by_org: Dict[UUID, Dict[Tuple[UUID, UUID], List[OTelFlatSpan]]] = {}
        batch_ids_by_span: Dict[int, str] = {}
        processed_message_ids: List[bytes] = []
        batch_bytes = 0
        processed_count = 0

        # 1. Deserialize & group by org + project/user (with size enforcement)
        for msg_id, data in batch:
            try:
                # Extract serialized span from Redis message
                span_bytes = data[b"data"]

                # Track cumulative batch size (compressed size)
                batch_bytes += len(span_bytes)

                # Check if we've exceeded the batch size limit
                if batch_bytes > self.max_batch_mb * 1024 * 1024:
                    log.warning(
                        "[INGEST] Batch size limit exceeded, stopping batch processing",
                        batch_bytes=batch_bytes,
                        max_mb=self.max_batch_mb,
                        processed_count=processed_count,
                    )
                    break

                # Deserialize (handles zlib decompression)
                msg = deserialize_span(span_bytes=span_bytes)

                # Group by org → (project, user)
                spans_by_org.setdefault(msg.organization_id, {}).setdefault(
                    (msg.project_id, msg.user_id), []
                ).append(msg.span_dto)
                if msg.batch_id:
                    batch_ids_by_span[id(msg.span_dto)] = msg.batch_id

                processed_message_ids.append(msg_id)
                processed_count += 1

            except Exception as e:
                log.error(
                    f"[INGEST] Failed to deserialize span: {e}",
                    msg_id=msg_id,
                )
                # ACK unprocessable messages to prevent PEL buildup
                processed_message_ids.append(msg_id)

        if not spans_by_org:
            return (processed_count, processed_message_ids)

        batches_by_trace: Dict[TraceKey, Set[str]] = {}

        # 2. Enforce entitlements per org (Layer 2, authoritative - same as PR #1223)
        for organization_id, spans_by_proj_user in spans_by_org.items():
            # Count root spans (delta)
            delta = sum(
                len([s for s in spans if s.parent_id is None])
                for spans in spans_by_proj_user.values()
            )

            meter = None
            allowed = True

            if is_ee() and delta > 0:
                try:
                    # Layer 2: Authoritative DB check + adjust (cache=False for hard check)
                    allowed, meter, rollback = await check_entitlements(  # type: ignore
                        key=Counter.TRACES_INGESTED,  # type: ignore
                        delta=delta,
                        scope=scope_from(organization_id=organization_id),  # type: ignore
                    )

                    if not allowed:
                        log.warning(
                            "[INGEST] Quota exceeded, dropping batch",
                            org_id=str(organization_id),
                            delta=delta,
                        )
                        continue  # Skip this org's spans

                except Exception as e:
                    log.error(
                        "[INGEST] Entitlements check failed",
                        org_id=str(organization_id),
                        error=str(e),
                    )
                    # On error, drop batch to be safe
                    continue

            # 3. Create spans per project/user
            for (project_id, user_id), span_dtos in spans_by_proj_user.items():
                try:
                    await self.service.ingest(
                        project_id=project_id,
                        user_id=user_id,
                        span_dtos=span_dtos,
                    )

                    for span_dto in span_dtos:
                        batch_id = batch_ids_by_span.get(id(span_dto))
                        if batch_id:
                            batches_by_trace.setdefault(
                                (project_id, UUID(str(span_dto.trace_id))), set()
                            ).add(batch_id)

                except Exception as e:
                    log.error(
                        "[INGEST] Failed to create spans",
                        org_id=str(organization_id),
                        project_id=str(project_id),
                        user_id=str(user_id),
                        error=str(e),
                        exc_info=True,
                    )
                    # Sleep briefly to avoid hammering DB on errors
                    await asyncio.sleep(0.05)

        await self.schedule_totals(batches_by_trace)

        # Return count and message IDs for ACK/DEL
        return (processed_count, processed_message_ids)
