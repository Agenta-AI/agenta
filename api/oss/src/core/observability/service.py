from uuid import UUID
from typing import List, Optional, Tuple
from asyncio import (
    Queue,
    Lock,
    get_event_loop,
    wait_for,
    TimeoutError,
    QueueEmpty,
    sleep,
)
from orjson import dumps, loads

from oss.src.utils.logging import get_module_logger

from oss.src.core.observability.interfaces import ObservabilityDAOInterface
from oss.src.core.observability.dtos import (
    QueryDTO,
    AnalyticsDTO,
    SpanDTO,
    BucketDTO,
)
from oss.src.core.observability.utils import (
    parse_span_dtos_to_span_idx,
    parse_span_idx_to_span_id_tree,
    calculate_costs,
    cumulate_costs,
    cumulate_tokens,
    connect_children,
    parse_filtering,
    parse_ingest,
)

log = get_module_logger(__name__)


class ObservabilityService:
    _buffer_queue: Optional[Queue] = None
    _buffer_lock: Optional[Lock] = None
    _buffer_size: int = 0
    _buffer_bytes: int = 0

    _MAX_BUFFER_SIZE = 100 * 1000  # 100,000
    _MAX_BUFFER_BYTES = 256 * 1024 * 1024  # 256 MB

    _MAX_BATCH_SIZE = 1_000  # 1,000
    _MAX_BATCH_BYTES = 5 * 1024 * 1024  # 5 MB
    _MAX_BATCH_AGE = 0.250  # 250 ms
    _MIN_BATCH_AGE = 0.100  # 100 ms

    def __init__(self, observability_dao):
        self.observability_dao = observability_dao

        # ✅ Initializes buffer queue + lock only once per process.
        # Without this, multiple service instances could create multiple queues.
        if not ObservabilityService._buffer_queue:
            ObservabilityService._buffer_queue = Queue()
            ObservabilityService._buffer_lock = Lock()

    @property
    def buffer_queue(self) -> Optional[Queue]:
        return ObservabilityService._buffer_queue

    @property
    def buffer_lock(self) -> Optional[Lock]:
        return ObservabilityService._buffer_lock

    @property
    def buffer_size(self) -> int:
        return ObservabilityService._buffer_size

    @property
    def buffer_bytes(self) -> int:
        return ObservabilityService._buffer_bytes

    async def enqueue_batch(
        self,
        items: List[bytes],
        *,
        max_size: Optional[int] = None,
        max_bytes: Optional[int] = None,
    ) -> bool:
        """
        Atomically enqueue a batch.
        Accepts the whole batch or rejects everything if limits would be exceeded.
        """
        if not self.buffer_queue or not self.buffer_lock:
            return False

        max_size = max_size or ObservabilityService._MAX_BUFFER_SIZE
        max_bytes = max_bytes or ObservabilityService._MAX_BUFFER_BYTES

        batch_size = len(items)
        batch_bytes = sum(len(item) for item in items)

        # log.debug(
        #     "[NODES] [SET]   [%d] nodes [%d] bytes",
        #     batch_size,
        #     batch_bytes,
        # )

        async with self.buffer_lock:
            # ✅ Reject batch entirely if it would overflow either threshold
            if (
                ObservabilityService._buffer_size + batch_size > max_size
                or ObservabilityService._buffer_bytes + batch_bytes > max_bytes
            ):
                log.debug("[NODES] [SET]   overflow")
                return False

            # ✅ Safe to enqueue everything since thresholds are respected
            for item in items:
                await self.buffer_queue.put(item)

            # ✅ Update counters atomically *after* enqueuing
            ObservabilityService._buffer_size += batch_size
            ObservabilityService._buffer_bytes += batch_bytes

            log.debug(
                "[NODES] [STATS] [%d] nodes [%d] bytes",
                ObservabilityService._buffer_size,
                ObservabilityService._buffer_bytes,
            )

            return True

    async def dequeue_batch(
        self,
        *,
        max_size: Optional[int] = None,
        max_bytes: Optional[int] = None,
        max_age: Optional[float] = None,
        min_age: Optional[float] = None,
    ) -> List[bytes]:
        """
        Dequeue a batch up to max_size items or max_bytes total,
        waiting up to max_age seconds for the first item.
        """
        if not self.buffer_queue or not self.buffer_lock:
            return []

        max_size = max_size or ObservabilityService._MAX_BATCH_SIZE
        max_bytes = max_bytes or ObservabilityService._MAX_BATCH_BYTES
        max_age = max_age or ObservabilityService._MAX_BATCH_AGE
        min_age = min_age or ObservabilityService._MIN_BATCH_AGE

        items: List[bytes] = []
        batch_size = 0
        batch_bytes = 0
        start = get_event_loop().time()

        try:
            # ✅ Wait up to max_age for the *first* item, otherwise return []
            item = await wait_for(self.buffer_queue.get(), timeout=max_age)
        except TimeoutError:
            return []

        # ✅ First item is always included if retrieved
        items.append(item)
        batch_size += 1
        batch_bytes += len(item)

        # ✅ Update counters for the first item
        async with self.buffer_lock:
            ObservabilityService._buffer_size -= 1
            ObservabilityService._buffer_bytes -= len(item)

        delay = max(0, start + min_age - get_event_loop().time())

        if delay > 0:
            await sleep(delay)

        # ✅ Drain as many items as possible until thresholds are hit or queue is empty
        while True:
            elapsed = get_event_loop().time() - start

            # ✅ Stop if thresholds are reached or time window expired
            if elapsed >= max_age or batch_size >= max_size or batch_bytes >= max_bytes:
                break

            try:
                item = self.buffer_queue.get_nowait()
            except QueueEmpty:
                break

            items.append(item)
            batch_size += 1
            batch_bytes += len(item)

            # ✅ Update counters for each dequeued item
            async with self.buffer_lock:
                ObservabilityService._buffer_size -= 1
                ObservabilityService._buffer_bytes -= len(item)

        # log.debug(
        #     "[NODES] [GET]   [%d] nodes [%d] bytes",
        #     batch_size,
        #     batch_bytes,
        # )
        # log.debug(
        #     "[NODES] [STATS] [%d] nodes [%d] bytes",
        #     ObservabilityService._buffer_size,
        #     ObservabilityService._buffer_bytes,
        # )

        return items

    def serialize(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        span_dto: SpanDTO,
    ) -> bytes:
        """
        Serialize as:
        {
            "organization_id": <hex string>,
            "project_id": <hex string>,
            "span_dto": <dict from model_dump>
        }
        """
        data = dict(
            organization_id=organization_id.hex,
            project_id=project_id.hex,
            span_dto=span_dto.model_dump(
                mode="json",
                # exclude_none=True,
                exclude_unset=True,
            ),
        )

        span_bytes = dumps(data)

        if b"\x00" in span_bytes:
            span_bytes = (
                span_bytes.decode(
                    "utf-8",
                    "replace",
                )
                .replace("\x00", "")
                .encode("utf-8")
            )

        return span_bytes

    def deserialize(
        self,
        *,
        span_bytes: bytes,
    ) -> Tuple[UUID, UUID, SpanDTO]:
        """
        Deserialize into (organization_id, project_id, SpanDTO).
        """
        data = loads(span_bytes)

        organization_id = UUID(hex=data["organization_id"])
        project_id = UUID(hex=data["project_id"])
        span_dto = SpanDTO(**data["span_dto"])

        return (organization_id, project_id, span_dto)

    async def query(
        self,
        *,
        project_id: UUID,
        query_dto: QueryDTO,
    ) -> Tuple[List[SpanDTO], Optional[int]]:
        if query_dto.filtering:
            parse_filtering(query_dto.filtering)

        span_dtos, count = await self.observability_dao.query(
            project_id=project_id,
            query_dto=query_dto,
        )

        if query_dto.grouping and query_dto.grouping.focus.value != "node":
            span_idx = parse_span_dtos_to_span_idx(span_dtos)

            span_id_tree = parse_span_idx_to_span_id_tree(span_idx)

            connect_children(span_id_tree, span_idx)

            span_dtos = [
                span_dto for span_dto in span_idx.values() if span_dto.parent is None
            ]

        return span_dtos, count

    async def analytics(
        self,
        *,
        project_id: UUID,
        analytics_dto: AnalyticsDTO,
    ) -> Tuple[List[BucketDTO], Optional[int]]:
        if analytics_dto.filtering:
            parse_filtering(analytics_dto.filtering)

        bucket_dtos, count = await self.observability_dao.analytics(
            project_id=project_id,
            analytics_dto=analytics_dto,
        )

        return bucket_dtos, count

    async def ingest(
        self,
        *,
        project_id: UUID,
        span_dtos: List[SpanDTO],
    ) -> None:
        parse_ingest(span_dtos)

        span_idx = parse_span_dtos_to_span_idx(span_dtos)

        span_id_tree = parse_span_idx_to_span_id_tree(span_idx)

        calculate_costs(span_idx)

        cumulate_costs(span_id_tree, span_idx)

        cumulate_tokens(span_id_tree, span_idx)

        await self.observability_dao.create_many(
            project_id=project_id,
            span_dtos=span_idx.values(),
        )

    async def create(
        self,
        *,
        project_id: UUID,
        span_dto: Optional[SpanDTO] = None,
        span_dtos: Optional[List[SpanDTO]] = None,
    ) -> SpanDTO:
        if span_dto:
            return await self.observability_dao.create_one(
                project_id=project_id,
                span_dto=span_dto,
            )

        if span_dtos:
            return await self.observability_dao.create_many(
                project_id=project_id,
                span_dtos=span_dtos,
            )

    async def read(
        self,
        *,
        project_id: UUID,
        node_id: Optional[UUID] = None,
        node_ids: Optional[List[UUID]] = None,
    ) -> SpanDTO:
        if node_id:
            return await self.observability_dao.read_one(
                project_id=project_id,
                node_id=node_id,
            )

        if node_ids:
            return await self.observability_dao.read_many(
                project_id=project_id,
                node_ids=node_ids,
            )

    async def delete(
        self,
        *,
        project_id: UUID,
        node_id: Optional[UUID] = None,
        node_ids: Optional[List[UUID]] = None,
    ):
        if node_id:
            return await self.observability_dao.delete_one(
                project_id=project_id,
                node_id=node_id,
            )

        if node_ids:
            return await self.observability_dao.delete_many(
                project_id=project_id,
                node_ids=node_ids,
            )
