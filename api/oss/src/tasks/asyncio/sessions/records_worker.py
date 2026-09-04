from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from redis.asyncio import Redis

from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.sessions.records.dtos import TERMINAL_RECORD_TYPE
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.records.streaming import deserialize_record
from oss.src.core.sessions.watch.interfaces import SessionsWatchPublisherInterface
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.tasks.asyncio.shared.consumer import StreamConsumer

log = get_module_logger(__name__)

if is_ee():
    from ee.src.core.access.entitlements.service import check_entitlements, scope_from
    from ee.src.core.access.entitlements.types import Counter


# The marker the runner stamps on its terminal record when the turn stopped to wait for a
# human instead of finishing (services/runner/src/tracing/otel.ts: the field is written ONLY
# for a pause and omitted on every other stop reason).
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
    1. Read batch from stream (XREADGROUP), or reclaim unacknowledged entries — StreamConsumer
    2. Deserialize messages
    3. Group by project_id
    4. EE: L2 quota check per org (Counter.RECORDS_INGESTED)
    5. Append record events to DB
    6. Reconcile HITL gates orphaned by a finished turn
    7. ACK + DEL only the messages whose Postgres write committed — StreamConsumer

    A message id leaves this worker in the acknowledged list for exactly three reasons: its
    write committed, it could not be decoded, or its org is over quota. Everything else stays
    pending so the reclaim pass writes it later. Acknowledging before the write, which is what
    this worker used to do, turned every Postgres failure into permanent silent record loss.
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
            # Records are the durable transcript. A pending entry that is never redelivered is
            # a lost turn, so this worker always runs the reclaim pass.
            reclaim_pending=True,
            reclaim_min_idle_ms=reclaim_min_idle_ms,
            max_deliveries=max_deliveries,
        )
        self.service = service
        self.watch_publisher = watch_publisher
        # Absent disables gate reconciliation (minimal test compositions), which only loses the
        # safety net — never the append.
        self.interactions_service = interactions_service

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

    def describe_message(self, data: Dict[bytes, bytes]) -> Optional[str]:
        """`session:record:type` for the dropped-message log, so a loss is traceable."""
        try:
            record = deserialize_record(payload=data[b"data"]).record_event
            return f"{record.session_id}:{record.record_id}:{record.record_type}"
        except Exception:
            return None

    async def _append(
        self,
        *,
        project_id: UUID,
        entries: List[Tuple[bytes, Any]],
    ) -> Tuple[int, bool]:
        """One `append_many` call. Returns the rows written and whether it committed."""
        try:
            results = await self.service.append_many(
                events=[msg.record_event for _, msg in entries],
            )
            quarantined = [
                row
                for row in results
                if getattr(row, "quarantined_at", None) is not None
            ]
            if quarantined:
                log.warning(
                    "[RECORDS] Quarantined late records for settled turns",
                    project_id=str(project_id),
                    quarantined=len(quarantined),
                    appended=len(results),
                    turns=sorted(
                        {f"{row.session_id}:{row.turn_id}" for row in quarantined}
                    ),
                )
            return len(results), True
        except Exception:
            log.error(
                "[RECORDS] Failed to append event batch",
                project_id=str(project_id),
                size=len(entries),
                exc_info=True,
            )
            return 0, False

    async def _append_committed(
        self,
        *,
        project_id: UUID,
        entries: List[Tuple[bytes, Any]],
    ) -> Tuple[int, List[bytes]]:
        """Write a project group and report the message ids that are durable.

        `append_many` is one statement in one transaction, so a single record Postgres rejects
        takes the whole group down with it. The retry writes the group one record at a time so
        the unrelated records still land. One record at a time rather than a binary split: the
        split is cheaper only when the failure is a lone poison record, and it is more expensive
        when Postgres itself is down, which is the common case.
        """
        appended, committed = await self._append(project_id=project_id, entries=entries)
        if committed:
            return appended, [msg_id for msg_id, _ in entries]

        if len(entries) == 1:
            return 0, []

        log.warning(
            "[RECORDS] Batch append failed, retrying one record at a time",
            project_id=str(project_id),
            size=len(entries),
        )

        total_appended = 0
        committed_ids: List[bytes] = []
        for entry in entries:
            appended, ok = await self._append(project_id=project_id, entries=[entry])
            if ok:
                total_appended += appended
                committed_ids.append(entry[0])

        log.warning(
            "[RECORDS] Retry finished",
            project_id=str(project_id),
            committed=len(committed_ids),
            pending=len(entries) - len(committed_ids),
        )
        return total_appended, committed_ids

    async def process_batch(
        self,
        batch: List[Tuple[bytes, Dict[bytes, bytes]]],
    ) -> Tuple[int, List[bytes]]:
        """Process batch — deserialize, group by org for EE quota, append to DB.

        The returned ids are acknowledged and deleted by the consumer loop, so an id only goes
        in once its rows are committed, or once this worker has decided to drop it on purpose.
        """
        groups: Dict[UUID, Dict[str, Any]] = {}
        acked_ids: List[bytes] = []
        batch_bytes = 0

        for msg_id, data in batch:
            try:
                payload = data[b"data"]

                batch_bytes += len(payload)
                if batch_bytes > self.max_batch_mb * 1024 * 1024:
                    # The rest of the batch stays unacknowledged and comes back through the
                    # reclaim pass, rather than being silently skipped.
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
                # A message that does not decode will not decode on redelivery either, so
                # acknowledge it instead of letting it hold the pending list. Counted as a loss.
                self.dropped_messages += 1
                acked_ids.append(msg_id)

        batches = list(groups.values())
        total_appended = 0

        org_allowed: Dict[UUID, bool] = {}
        # Orgs whose quota question could not be answered. Their records are not over quota,
        # they are unmetered, so they wait for the next delivery instead of being dropped.
        org_deferred: set = set()
        events_per_org: Dict[UUID, int] = {}

        if is_ee():
            for project_batch in batches:
                org_id = project_batch["organization_id"]
                if org_id is None:
                    continue
                events_per_org[org_id] = events_per_org.get(org_id, 0) + len(
                    project_batch["entries"]
                )

            for org_id, delta in events_per_org.items():
                if delta <= 0:
                    org_allowed[org_id] = True
                    continue

                try:
                    quota_allowed, _, _ = await check_entitlements(  # type: ignore
                        key=Counter.RECORDS_INGESTED,  # type: ignore
                        delta=delta,
                        scope=scope_from(organization_id=org_id),  # type: ignore
                    )
                except Exception:
                    log.error(
                        "[RECORDS] L2 quota check failed",
                        organization_id=str(org_id),
                        exc_info=True,
                    )
                    org_allowed[org_id] = False
                    org_deferred.add(org_id)
                    continue

                if not quota_allowed:
                    log.warning(
                        "[RECORDS] Quota exceeded, dropping org batch",
                        organization_id=str(org_id),
                        delta=delta,
                    )
                    org_allowed[org_id] = False
                    continue

                org_allowed[org_id] = True

        for project_batch in batches:
            org_id = project_batch["organization_id"]
            entries: List[Tuple[bytes, Any]] = project_batch["entries"]

            if is_ee() and org_id and not org_allowed.get(org_id, True):
                if org_id in org_deferred:
                    # The meter was unreachable, not exceeded. Leave the entries pending so a
                    # transient entitlements outage does not delete a conversation.
                    continue
                # An over-quota org is a deliberate product drop, so acknowledging is correct.
                # Count it, because it is still a record the transcript will never have.
                self.dropped_messages += len(entries)
                acked_ids.extend(msg_id for msg_id, _ in entries)
                continue

            appended, committed_ids = await self._append_committed(
                project_id=project_batch["project_id"],
                entries=entries,
            )
            total_appended += appended
            acked_ids.extend(committed_ids)

            if not committed_ids:
                continue

            committed = set(committed_ids)
            committed_events = [msg for msg_id, msg in entries if msg_id in committed]

            # Strictly post-append, and BEFORE the relay tee: a client woken by the records
            # notification below must already see the cancelled gate, not re-render it.
            await self.reconcile_orphaned_gates(
                project_id=project_batch["project_id"],
                events=committed_events,
            )

            # Relay tee (M3): strictly post-append so a notified client that
            # revalidates always sees the new rows. One publish per distinct
            # session in the project batch; failures never re-drive the append.
            if self.watch_publisher is not None:
                project_id = str(project_batch["project_id"])
                session_ids = {msg.record_event.session_id for msg in committed_events}
                for session_id in sorted(session_ids):
                    try:
                        await self.watch_publisher.records_changed(
                            project_id=project_id,
                            session_id=session_id,
                        )
                    except Exception:
                        log.warning(
                            "[RECORDS] Watch publish failed",
                            project_id=project_id,
                            session_id=session_id,
                        )

        return total_appended, acked_ids
