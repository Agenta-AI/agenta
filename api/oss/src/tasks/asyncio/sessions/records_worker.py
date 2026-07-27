from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from redis.asyncio import Redis

from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.records.streaming import deserialize_record
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.tasks.asyncio.shared.consumer import StreamConsumer

log = get_module_logger(__name__)

if is_ee():
    from ee.src.core.access.entitlements.service import check_entitlements, scope_from
    from ee.src.core.access.entitlements.types import Counter


class RecordsWorker(StreamConsumer):
    """
    Worker for record ingestion via dedicated Redis stream.

    Consumes from: streams:records
    Consumer group: worker-records

    Flow:
    1. Read batch from stream (XREADGROUP) — StreamConsumer
    2. Deserialize messages
    3. Group by project_id
    4. EE: L2 quota check per org (Counter.RECORDS_INGESTED)
    5. Append record events to DB
    6. ACK + DEL messages — StreamConsumer
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

    async def process_batch(
        self,
        batch: List[Tuple[bytes, Dict[bytes, bytes]]],
    ) -> Tuple[int, List[bytes]]:
        """Process batch — deserialize, group by org for EE quota, append to DB."""
        groups: Dict[UUID, Dict[str, Any]] = {}
        processed_ids: List[bytes] = []
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
                        "events": [],
                    }
                    groups[msg.project_id] = group
                group["events"].append(msg)
                processed_ids.append(msg_id)
            except Exception:
                log.error(
                    "[RECORDS] Failed to deserialize message",
                    msg_id=repr(msg_id),
                    exc_info=True,
                )
                processed_ids.append(msg_id)

        batches = list(groups.values())
        total_appended = 0

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
            if is_ee() and org_id and not org_allowed.get(org_id, True):
                continue

            try:
                results = await self.service.append_many(
                    events=[msg.record_event for msg in project_batch["events"]],
                )
                total_appended += len(results)
            except Exception:
                log.error(
                    "[RECORDS] Failed to append event batch",
                    project_id=str(project_batch["project_id"]),
                    exc_info=True,
                )

        return total_appended, processed_ids
