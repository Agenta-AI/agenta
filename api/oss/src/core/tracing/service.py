from typing import List, Optional, Tuple
from uuid import UUID
import zlib
from orjson import dumps, loads
from redis.asyncio import Redis

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

from oss.src.core.tracing.interfaces import TracingDAOInterface
from oss.src.core.tracing.utils import parse_query, parse_ingest
from oss.src.core.tracing.dtos import (
    OTelLink,
    OTelFlatSpan,
    TracingQuery,
    Bucket,
    MetricSpec,
    MetricsBucket,
)

from oss.src.core.tracing.utils import (
    parse_span_dtos_to_span_idx,
    parse_span_idx_to_span_id_tree,
    calculate_costs,
    cumulate_costs,
    cumulate_tokens,
)


log = get_module_logger(__name__)


class TracingService:
    """
    Tracing service with Redis Streams publishing.

    Replaces asyncio.Queue from PR #1223 with Redis Streams for persistence and scalability.
    """

    def __init__(
        self,
        tracing_dao: TracingDAOInterface,
        redis_client: Optional[Redis] = None,
    ):
        self.tracing_dao = tracing_dao
        self.redis = redis_client or Redis.from_url(
            env.REDIS_URL, decode_responses=False
        )

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dto: Optional[OTelFlatSpan] = None,
        span_dtos: Optional[List[OTelFlatSpan]] = None,
    ) -> List[OTelLink]:
        span_idx = parse_span_dtos_to_span_idx(
            [span_dto] if span_dto else span_dtos or []
        )

        span_id_tree = parse_span_idx_to_span_id_tree(span_idx)

        calculate_costs(span_idx)

        cumulate_costs(span_id_tree, span_idx)

        cumulate_tokens(span_id_tree, span_idx)

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
        query: TracingQuery,
    ) -> List[OTelFlatSpan]:
        parse_query(query)

        span_dtos = await self.tracing_dao.query(
            project_id=project_id,
            #
            query=query,
        )

        return span_dtos

    async def legacy_analytics(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
    ) -> List[Bucket]:
        parse_query(query)

        bucket_dtos = await self.tracing_dao.legacy_analytics(
            project_id=project_id,
            #
            query=query,
        )

        return bucket_dtos

    async def analytics(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
        specs: List[MetricSpec],
    ) -> List[MetricsBucket]:
        parse_query(query)

        bucket_dtos = await self.tracing_dao.analytics(
            project_id=project_id,
            #
            query=query,
            specs=specs,
        )

        return bucket_dtos

    # Redis Streams methods (from PR #1223, adapted for Redis Streams)

    def serialize(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        span_dto: OTelFlatSpan,
    ) -> bytes:
        """
        Serialize span for Redis Streams with compression.

        Args:
            organization_id: Organization UUID
            project_id: Project UUID
            user_id: User UUID
            span_dto: Span to serialize

        Returns:
            Compressed serialized span bytes
        """
        data = dict(
            organization_id=organization_id.hex,
            project_id=project_id.hex,
            user_id=user_id.hex,
            span_dto=span_dto.model_dump(mode="json", exclude_unset=True),
        )

        span_bytes = dumps(data)

        # Strip null bytes from serialized data
        if b"\x00" in span_bytes:
            span_bytes = (
                span_bytes.decode("utf-8", "replace")
                .replace("\x00", "")
                .encode("utf-8")
            )

        # Compress with zlib for efficient storage
        return zlib.compress(span_bytes)

    def deserialize(
        self, *, span_bytes: bytes
    ) -> Tuple[UUID, UUID, UUID, OTelFlatSpan]:
        """
        Deserialize span from Redis Streams with decompression.

        Args:
            span_bytes: Compressed serialized span bytes

        Returns:
            Tuple of (organization_id, project_id, user_id, span_dto)
        """
        # Decompress with zlib
        decompressed = zlib.decompress(span_bytes)
        data = loads(decompressed)

        organization_id = UUID(hex=data["organization_id"])
        project_id = UUID(hex=data["project_id"])
        user_id = UUID(hex=data["user_id"])
        span_dto = OTelFlatSpan(**data["span_dto"])

        return (organization_id, project_id, user_id, span_dto)

    async def get_meter_cache(self, *, organization_id: UUID) -> Optional[dict]:
        """
        Get cached TRACES meter from Redis.

        Used for soft checks (Layer 1) in OTLP router.

        Args:
            organization_id: Organization UUID

        Returns:
            Cached meter dict or None if not found
        """
        cache_key = f"meter:traces:{organization_id.hex}"
        try:
            cached = await self.redis.get(cache_key)
            if cached:
                return loads(cached)
        except Exception as e:
            log.warning(
                f"[TracingService] Failed to get meter cache: {e}",
                org_id=str(organization_id),
            )
        return None

    async def set_meter_cache(
        self, *, organization_id: UUID, meter_data: dict, ttl: int = 3600
    ) -> None:
        """
        Cache TRACES meter in Redis.

        Used after successful meter adjustment in worker.

        Args:
            organization_id: Organization UUID
            meter_data: Meter state dict with value, synced, etc.
            ttl: Cache TTL in seconds (default: 1 hour)
        """
        cache_key = f"meter:traces:{organization_id.hex}"
        try:
            cached = dumps(meter_data)
            await self.redis.setex(cache_key, ttl, cached)
            log.debug(
                f"[TracingService] Cached TRACES meter",
                org_id=str(organization_id),
                ttl=ttl,
            )
        except Exception as e:
            log.error(
                f"[TracingService] Failed to set meter cache: {e}",
                org_id=str(organization_id),
                exc_info=True,
            )

    async def publish_to_stream(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        span_dtos: List[OTelFlatSpan],
        stream_name: str = "streams:otlp",
    ) -> int:
        """
        Publish spans to Redis Streams.

        Replaces asyncio.Queue.put() from PR #1223.

        Args:
            organization_id: Organization UUID
            project_id: Project UUID
            user_id: User UUID
            span_dtos: Spans to publish
            stream_name: Stream name (default: streams:otlp)

        Returns:
            Number of spans published
        """
        count = 0

        for span_dto in span_dtos:
            span_bytes = self.serialize(
                organization_id=organization_id,
                project_id=project_id,
                user_id=user_id,
                span_dto=span_dto,
            )

            await self.redis.xadd(
                name=stream_name,
                fields={"data": span_bytes},
            )

            count += 1

        log.debug(
            f"[TracingService] Published {count} spans to {stream_name}",
            org_id=str(organization_id),
            project_id=str(project_id),
            user_id=str(user_id),
        )

        return count
