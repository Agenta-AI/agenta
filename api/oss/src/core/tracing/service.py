from typing import List, Optional, Tuple
from uuid import UUID
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

from oss.src.core.tracing.interfaces import TracingDAOInterface
from oss.src.core.tracing.dtos import OTelLink, OTelFlatSpan, Query, Bucket
from oss.src.core.tracing.utils import parse_query, parse_ingest


log = get_module_logger(__name__)


class TracingService:
    _buffer_queue: Optional[Queue] = None
    _buffer_lock: Optional[Lock] = None
    _buffer_size: int = 0
    _buffer_bytes: int = 0

    _MAX_BUFFER_SIZE = 100 * 1_000  # 100,000
    _MAX_BUFFER_BYTES = 256 * 1024 * 1024  # 256 MB

    _MAX_BATCH_SIZE = 1_000  # 1,000
    _MAX_BATCH_BYTES = 5 * 1024 * 1024  # 5 MB
    _MAX_BATCH_AGE = 0.250  # 250 ms
    _MIN_BATCH_AGE = 0.100  # 100 ms

    def __init__(
        self,
        tracing_dao: TracingDAOInterface,
    ):
        self.tracing_dao = tracing_dao

        # ✅ Initializes buffer queue + lock only once per process.
        # Without this, multiple service instances could create multiple queues.
        if not TracingService._buffer_queue:
            TracingService._buffer_queue = Queue()
            TracingService._buffer_lock = Lock()

    @property
    def buffer_queue(self) -> Optional[Queue]:
        return TracingService._buffer_queue

    @property
    def buffer_lock(self) -> Optional[Lock]:
        return TracingService._buffer_lock

    @property
    def buffer_size(self) -> int:
        return TracingService._buffer_size

    @property
    def buffer_bytes(self) -> int:
        return TracingService._buffer_bytes

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

        max_size = max_size or TracingService._MAX_BUFFER_SIZE
        max_bytes = max_bytes or TracingService._MAX_BUFFER_BYTES

        batch_size = len(items)
        batch_bytes = sum(len(item) for item in items)

        log.debug(
            "[SPANS] [SET]   [%d] spans [%d] bytes",
            batch_size,
            batch_bytes,
        )

        async with self.buffer_lock:
            # ✅ Reject batch entirely if it would overflow either threshold
            if (
                TracingService._buffer_size + batch_size > max_size
                or TracingService._buffer_bytes + batch_bytes > max_bytes
            ):
                log.debug("[SPANS] [SET]   overflow")
                return False

            # ✅ Safe to enqueue everything since thresholds are respected
            for item in items:
                await self.buffer_queue.put(item)

            # ✅ Update counters atomically *after* enqueuing
            TracingService._buffer_size += batch_size
            TracingService._buffer_bytes += batch_bytes

            log.debug(
                "[SPANS] [STATS] [%d] spans [%d] bytes",
                TracingService._buffer_size,
                TracingService._buffer_bytes,
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

        max_size = max_size or TracingService._MAX_BATCH_SIZE
        max_bytes = max_bytes or TracingService._MAX_BATCH_BYTES
        max_age = max_age or TracingService._MAX_BATCH_AGE
        min_age = min_age or TracingService._MIN_BATCH_AGE

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
            TracingService._buffer_size -= 1
            TracingService._buffer_bytes -= len(item)

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
                TracingService._buffer_size -= 1
                TracingService._buffer_bytes -= len(item)

        log.debug(
            "[SPANS] [GET]   [%d] spans [%d] bytes",
            batch_size,
            batch_bytes,
        )
        # log.debug(
        #     "[SPANS] [STATS] [%d] spans [%d] bytes",
        #     TracingService._buffer_size,
        #     TracingService._buffer_bytes,
        # )

        return items

    def serialize(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        span_dto: OTelFlatSpan,
    ) -> bytes:
        """
        Serialize as:
        {
            "organization_id": <hex string>,
            "project_id": <hex string>,
            "user_id": <hex string>,
            "span_dto": <dict from model_dump>
        }
        """
        data = dict(
            organization_id=organization_id.hex,
            project_id=project_id.hex,
            user_id=user_id.hex,
            span_dto=span_dto.model_dump(
                mode="json",
                exclude_none=True,
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
    ) -> Tuple[UUID, UUID, UUID, OTelFlatSpan]:
        """
        Deserialize into (organization_id, project_id, user_id, OTelFlatSpan).
        """
        data = loads(span_bytes)

        organization_id = UUID(hex=data["organization_id"])
        project_id = UUID(hex=data["project_id"])
        user_id = UUID(hex=data["user_id"])
        span_dto = OTelFlatSpan(**data["span_dto"])

        return (organization_id, project_id, user_id, span_dto)

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dto: Optional[OTelFlatSpan] = None,
        span_dtos: Optional[List[OTelFlatSpan]] = None,
    ) -> List[OTelLink]:
        if span_dto:
            link = await self.tracing_dao.create_span(
                project_id=project_id,
                user_id=user_id,
                #
                span_dto=span_dto,
            )

            return [link] if link else []

        if span_dtos:
            links = await self.tracing_dao.create_spans(
                project_id=project_id,
                user_id=user_id,
                #
                span_dtos=span_dtos,
            )

            return links

        return []

    async def read(
        self,
        *,
        project_id: UUID,
        #
        trace_id: Optional[UUID] = None,
        trace_ids: Optional[List[UUID]] = None,
        span_id: Optional[UUID] = None,
        span_ids: Optional[List[UUID]] = None,
    ) -> List[OTelFlatSpan]:
        if trace_id:
            span_dtos = await self.tracing_dao.read_trace(
                project_id=project_id,
                #
                trace_id=trace_id,
            )

            return span_dtos

        if trace_ids:
            span_dtos = await self.tracing_dao.read_traces(
                project_id=project_id,
                #
                trace_ids=trace_ids,
            )

            return span_dtos

        if span_id:
            span_dtos = await self.tracing_dao.read_span(
                project_id=project_id,
                #
                span_id=span_id,
            )

            return [span_dtos] if span_dtos else []

        if span_ids:
            span_dtos = await self.tracing_dao.read_spans(
                project_id=project_id,
                #
                span_ids=span_ids,
            )

            return span_dtos

        return []

    async def update(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dto: Optional[OTelFlatSpan] = None,
        span_dtos: Optional[List[OTelFlatSpan]] = None,
    ) -> List[OTelLink]:
        if span_dto:
            link = await self.tracing_dao.update_span(
                project_id=project_id,
                user_id=user_id,
                #
                span_dto=span_dto,
            )

            return [link] if link else []

        if span_dtos:
            links = await self.tracing_dao.update_spans(
                project_id=project_id,
                user_id=user_id,
                #
                span_dtos=span_dtos,
            )

            return links

        return []

    async def delete(
        self,
        *,
        project_id: UUID,
        #
        trace_id: Optional[UUID] = None,
        trace_ids: Optional[List[UUID]] = None,
        span_id: Optional[UUID] = None,
        span_ids: Optional[List[UUID]] = None,
    ) -> List[OTelLink]:
        if trace_id:
            links = await self.tracing_dao.delete_trace(
                project_id=project_id,
                #
                trace_id=trace_id,
            )

            return links

        if trace_ids:
            links = await self.tracing_dao.delete_traces(
                project_id=project_id,
                #
                trace_ids=trace_ids,
            )

            return links

        if span_id:
            link = await self.tracing_dao.delete_span(
                project_id=project_id,
                #
                span_id=span_id,
            )

            return [link] if link else []

        if span_ids:
            links = await self.tracing_dao.delete_spans(
                project_id=project_id,
                #
                span_ids=span_ids,
            )

            return links

        return []

    async def query(
        self,
        *,
        project_id: UUID,
        #
        query: Query,
    ) -> List[OTelFlatSpan]:
        parse_query(query)

        span_dtos = await self.tracing_dao.query(
            project_id=project_id,
            #
            query=query,
        )

        return span_dtos

    async def analytics(
        self,
        *,
        project_id: UUID,
        #
        query: Query,
    ) -> List[Bucket]:
        parse_query(query)

        bucket_dtos = await self.tracing_dao.analytics(
            project_id=project_id,
            #
            query=query,
        )

        return bucket_dtos
