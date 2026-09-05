from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from redis.asyncio import Redis

from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.records.types import RecordContentConflict
from oss.src.core.sessions.records.streaming import deserialize_record
from oss.src.core.sessions.watch.interfaces import SessionsWatchPublisherInterface
from oss.src.utils.logging import get_module_logger
from oss.src.tasks.asyncio.shared.consumer import StreamConsumer

log = get_module_logger(__name__)

# The runner's terminal per-turn record, and the marker it stamps on that record when the turn
# stopped to wait for a human instead of finishing (services/runner/src/tracing/otel.ts: the
# field is written ONLY for a pause and omitted on every other stop reason).
TERMINAL_RECORD_TYPE = "done"
PAUSED_STOP_REASON = "paused"


def finished_turns_in_batch(events: List[Any]) -> Dict[str, str]:
    """`session_id -> turn_id` for every turn in this batch that FINISHED without pausing.

    A gate row exists only because a turn paused for a human, so a turn whose terminal record
    carries no pause marker is holding no gate — and neither is its session, whose live process
    is gone. That is the reconciliation trigger. The last finished turn per session wins, and the
    caller cancels only that turn's own gates.
    """
    finished: Dict[str, str] = {}
    for msg in events:
        record = msg.record_event
        if record.record_type != TERMINAL_RECORD_TYPE or not record.turn_id:
            continue
        if (record.attributes or {}).get("stopReason") == PAUSED_STOP_REASON:
            continue
        finished[record.session_id] = record.turn_id
    return finished


class RecordsWorker(StreamConsumer):
    """
    Worker for record ingestion via dedicated Redis stream.

    Consumes from: streams:records
    Consumer group: worker-records

    Flow:
    1. Read batch from stream (XREADGROUP) — StreamConsumer
    2. Deserialize messages
    3. Group by project_id
    4. Append record events to DB (session history is quota-exempt)
    5. Reconcile HITL gates orphaned by a finished turn
    6. ACK + DEL only messages whose write committed or whose stable id was rejected
    """

    log_prefix = "[RECORDS]"

    def __init__(
        self,
        service: RecordsService,
        redis_client: Redis,
        stream_name: str,
        consumer_group: str,
        consumer_name: Optional[str] = None,
        max_batch_size: int = 50,
        max_block_ms: int = 5000,
        max_delay_ms: int = 250,
        max_batch_mb: int = 50,
        watch_publisher: Optional[SessionsWatchPublisherInterface] = None,
        interactions_service: Optional[SessionInteractionsService] = None,
        reclaim_min_idle_ms: int = 30_000,
        max_deliveries: int = 5,
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
            reclaim_pending=True,
            reclaim_min_idle_ms=reclaim_min_idle_ms,
            max_deliveries=max_deliveries,
        )
        self.service = service
        self.watch_publisher = watch_publisher
        # Absent disables gate reconciliation (minimal test compositions), which only loses the
        # safety net — never the append.
        self.interactions_service = interactions_service

    def describe_message(self, data: Dict[bytes, bytes]) -> Optional[str]:
        try:
            record = deserialize_record(payload=data[b"data"]).record_event
            return f"{record.session_id}:{record.record_id}:{record.record_type}"
        except Exception:
            return None

    async def reconcile_orphaned_gates(
        self,
        *,
        project_id: UUID,
        events: List[Any],
    ) -> None:
        """Safety net: no HITL gate may outlive its turn.

        A `session_interactions` row is created only when a turn pauses for a human. Once a turn
        reaches its terminal record WITHOUT pausing, no process is holding a gate for that
        session, so any row still `pending` can never be answered — yet both inboxes keep
        offering it forever. That is the orphaned gate. Cancel those rows here, at the one place
        that sees every turn's terminal record.

        A legitimately parked gate is protected twice:

        * a terminal record carrying the pause marker is skipped outright — that turn IS the
          live park, and its gate is exactly what the human is being asked to answer;
        * the cancel is scoped to the finished turn's OWN gates. A newer turn carries a
          different `turn_id`, so no interleaving can put its live park in range — this worker
          may lag arbitrarily far behind the stream and still never cancel underneath a turn
          that is parked right now. Prior turns' leftovers are not this sweep's job: the runner
          clears them at turn start through `/sessions/interactions/cancel-stale`.

        The cancel fans out on the watch plane (the service publishes on a non-zero count), so a
        client sitting on a stuck approval drops it without a reload. Best effort throughout — a
        failure here must never re-drive the record append.
        """
        if self.interactions_service is None:
            return

        for session_id, turn_id in finished_turns_in_batch(events).items():
            try:
                cancelled = await self.interactions_service.cancel_session_pending(
                    project_id=project_id,
                    session_id=session_id,
                    only_turn_id=str(turn_id),
                )
                if cancelled:
                    log.info(
                        "[RECORDS] Cancelled gates orphaned by a finished turn",
                        project_id=str(project_id),
                        session_id=session_id,
                        turn_id=str(turn_id),
                        cancelled=cancelled,
                    )
            except Exception:
                log.warning(
                    "[RECORDS] Gate reconciliation failed",
                    project_id=str(project_id),
                    session_id=session_id,
                    exc_info=True,
                )

    async def process_batch(
        self,
        batch: List[Tuple[bytes, Dict[bytes, bytes]]],
    ) -> Tuple[int, List[bytes]]:
        """Process batch and acknowledge only durable or explicitly rejected records."""
        groups: Dict[UUID, Dict[str, Any]] = {}
        acknowledged_ids: List[bytes] = []
        batch_bytes = 0

        for msg_id, data in batch:
            try:
                payload = data[b"data"]

                batch_bytes += len(payload)
                if batch_bytes > self.max_batch_mb * 1024 * 1024:
                    break

                msg = deserialize_record(payload=payload)
                group = groups.get(msg.project_id)
                if group is None:
                    group = {
                        "organization_id": msg.organization_id,
                        "project_id": msg.project_id,
                        "entries": [],
                    }
                    groups[msg.project_id] = group
                group["entries"].append((msg_id, msg))
            except Exception:
                log.error(
                    "[RECORDS] Failed to deserialize message",
                    msg_id=repr(msg_id),
                    exc_info=True,
                )
                self.dropped_messages += 1
                acknowledged_ids.append(msg_id)

        batches = list(groups.values())
        total_appended = 0

        for project_batch in batches:
            entries: List[Tuple[bytes, Any]] = project_batch["entries"]
            try:
                result = await self.service.append_many(
                    events=[msg.record_event for _, msg in entries],
                )
                total_appended += len(result.records)
                self.mark_committed()
            except RecordContentConflict as exc:
                log.error(
                    "[RECORDS] Rejected conflicting stable record ids",
                    project_id=str(project_batch["project_id"]),
                    record_ids=[str(item.record_id) for item in exc.conflicts],
                )
                if len(entries) == 1:
                    acknowledged_ids.append(entries[0][0])
                else:
                    for entry in entries:
                        (
                            appended,
                            committed_ids,
                            committed_events,
                        ) = await self._append_one(
                            project_id=project_batch["project_id"],
                            entry=entry,
                        )
                        total_appended += appended
                        acknowledged_ids.extend(committed_ids)
                        await self._after_commit(
                            project_id=project_batch["project_id"],
                            events=committed_events,
                        )
                continue
            except Exception:
                log.error(
                    "[RECORDS] Failed to append event batch",
                    project_id=str(project_batch["project_id"]),
                    exc_info=True,
                )
                if len(entries) > 1:
                    for entry in entries:
                        (
                            appended,
                            committed_ids,
                            committed_events,
                        ) = await self._append_one(
                            project_id=project_batch["project_id"],
                            entry=entry,
                        )
                        total_appended += appended
                        acknowledged_ids.extend(committed_ids)
                        await self._after_commit(
                            project_id=project_batch["project_id"],
                            events=committed_events,
                        )
                continue

            acknowledged_ids.extend(msg_id for msg_id, _ in entries)
            conflicts = set(result.conflicting_record_ids)
            committed_events = [
                msg
                for _, msg in entries
                if (msg.record_event.record_id or msg.record_event.producer_id)
                not in conflicts
            ]
            await self._after_commit(
                project_id=project_batch["project_id"],
                events=committed_events,
            )

        return total_appended, acknowledged_ids

    async def _append_one(
        self,
        *,
        project_id: UUID,
        entry: Tuple[bytes, Any],
    ) -> Tuple[int, List[bytes], List[Any]]:
        msg_id, msg = entry
        try:
            result = await self.service.append_many(events=[msg.record_event])
        except RecordContentConflict as exc:
            log.error(
                "[RECORDS] Rejected conflicting stable record ids",
                project_id=str(project_id),
                record_ids=[str(item.record_id) for item in exc.conflicts],
            )
            return 0, [msg_id], []
        except Exception:
            log.error(
                "[RECORDS] Failed to append event",
                project_id=str(project_id),
                msg_id=repr(msg_id),
                exc_info=True,
            )
            return 0, [], []

        conflict_ids = set(result.conflicting_record_ids)
        record_id = msg.record_event.record_id or msg.record_event.producer_id
        committed_events = [] if record_id in conflict_ids else [msg]
        self.mark_committed()
        return len(result.records), [msg_id], committed_events

    async def _after_commit(
        self,
        *,
        project_id: UUID,
        events: List[Any],
    ) -> None:
        if not events:
            return

        # Strictly post-append, and BEFORE the relay tee: a client woken by the records
        # notification below must already see the cancelled gate, not re-render it.
        await self.reconcile_orphaned_gates(project_id=project_id, events=events)

        # Relay tee (M3): strictly post-append so a notified client that
        # revalidates always sees the new rows. One publish per distinct
        # session in the project batch; failures never re-drive the append.
        if self.watch_publisher is not None:
            project_id_str = str(project_id)
            session_ids = {msg.record_event.session_id for msg in events}
            for session_id in sorted(session_ids):
                try:
                    await self.watch_publisher.records_changed(
                        project_id=project_id_str,
                        session_id=session_id,
                    )
                except Exception:
                    log.warning(
                        "[RECORDS] Watch publish failed",
                        project_id=project_id_str,
                        session_id=session_id,
                    )
