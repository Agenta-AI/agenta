from typing import List, Optional, Tuple
from uuid import UUID
from datetime import datetime

from oss.src.utils.logging import get_module_logger

from oss.src.core.tracing.interfaces import TracingDAOInterface
from oss.src.core.tracing.utils import parse_query
from oss.src.core.tracing.dtos import (
    OTelLink,
    OTelFlatSpan,
    TracingQuery,
    Bucket,
    MetricSpec,
    MetricsBucket,
    #
    Windowing,
)


log = get_module_logger(__name__)


class TracingService:
    """
    Tracing service for managing spans and traces.
    """

    def __init__(
        self,
        tracing_dao: TracingDAOInterface,
    ):
        self.tracing_dao = tracing_dao

    ## SPANS

    async def ingest(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dtos: List[OTelFlatSpan],
    ) -> List[OTelLink]:
        """Ingest spans (upsert: create if new, update if exists)."""
        return await self.tracing_dao.ingest(
            project_id=project_id,
            user_id=user_id,
            #
            span_dtos=span_dtos,
        )

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

    ## TRACES

    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelFlatSpan]:
        """Fetch all spans for the given trace IDs."""
        return await self.tracing_dao.fetch(
            project_id=project_id,
            #
            trace_ids=trace_ids,
        )

    async def delete(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelLink]:
        """Delete all spans for the given trace IDs."""
        return await self.tracing_dao.delete(
            project_id=project_id,
            #
            trace_ids=trace_ids,
        )

    ## SESSIONS & USERS

    async def sessions(
        self,
        *,
        project_id: UUID,
        #
        realtime: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> Tuple[List[str], Optional[datetime]]:
        return await self.tracing_dao.sessions(
            project_id=project_id,
            #
            realtime=realtime,
            #
            windowing=windowing,
        )

    async def users(
        self,
        *,
        project_id: UUID,
        #
        realtime: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> Tuple[List[str], Optional[datetime]]:
        return await self.tracing_dao.users(
            project_id=project_id,
            #
            realtime=realtime,
            #
            windowing=windowing,
        )
