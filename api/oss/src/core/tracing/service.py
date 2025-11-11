from uuid import UUID
from typing import List, Optional

from oss.src.utils.logging import get_module_logger

from oss.src.core.tracing.interfaces import TracingDAOInterface
from oss.src.core.tracing.dtos import (
    OTelLink,
    OTelLinks,
    OTelFlatSpan,
    OTelFlatSpans,
    Query,
)
from oss.src.core.tracing.utils import (
    parse_query,
    parse_ingest,
)

log = get_module_logger(__name__)


class TracingService:
    def __init__(
        self,
        tracing_dao: TracingDAOInterface,
    ):
        self.tracing_dao = tracing_dao

    ### CRUD

    async def create(
        self,
        *,
        project_id: UUID,
        span_dto: Optional[OTelFlatSpan] = None,
        span_dtos: Optional[OTelFlatSpans] = None,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLinks]:
        if span_dto:
            link = await self.tracing_dao.create_span(
                project_id=project_id,
                span_dto=span_dto,
                user_id=user_id,
            )

            return [link] if link else None

        if span_dtos:
            links = await self.tracing_dao.create_spans(
                project_id=project_id,
                span_dtos=span_dtos,
                user_id=user_id,
            )

            return links

        return None

    async def read(
        self,
        *,
        project_id: UUID,
        trace_id: Optional[UUID] = None,
        trace_ids: Optional[List[UUID]] = None,
        span_id: Optional[UUID] = None,
        span_ids: Optional[List[UUID]] = None,
    ) -> Optional[OTelFlatSpans]:
        if trace_id:
            span_dtos = await self.tracing_dao.read_trace(
                project_id=project_id,
                trace_id=trace_id,
            )

            return span_dtos

        if trace_ids:
            span_dtos = await self.tracing_dao.read_traces(
                project_id=project_id,
                trace_ids=trace_ids,
            )

            return span_dtos

        if span_id:
            span_dtos = await self.tracing_dao.read_span(
                project_id=project_id,
                span_id=span_id,
            )

            return [span_dtos] if span_dtos else None

        if span_ids:
            span_dtos = await self.tracing_dao.read_spans(
                project_id=project_id,
                span_ids=span_ids,
            )

            return span_dtos

        return None

    async def update(
        self,
        *,
        project_id: UUID,
        span_dto: Optional[OTelFlatSpan] = None,
        span_dtos: Optional[OTelFlatSpans] = None,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLinks]:
        if span_dto:
            link = await self.tracing_dao.update_span(
                project_id=project_id,
                span_dto=span_dto,
                user_id=user_id,
            )

            return [link] if link else None

        if span_dtos:
            links = await self.tracing_dao.update_spans(
                project_id=project_id,
                span_dtos=span_dtos,
                user_id=user_id,
            )

            return links

        return None

    async def delete(
        self,
        *,
        project_id: UUID,
        trace_id: Optional[UUID] = None,
        trace_ids: Optional[List[UUID]] = None,
        span_id: Optional[UUID] = None,
        span_ids: Optional[List[UUID]] = None,
        user_id: Optional[UUID] = None,
    ) -> Optional[OTelLinks]:
        if trace_id:
            links = await self.tracing_dao.delete_trace(
                project_id=project_id,
                trace_id=trace_id,
                user_id=user_id,
            )

            return links

        if trace_ids:
            links = await self.tracing_dao.delete_traces(
                project_id=project_id,
                trace_ids=trace_ids,
                user_id=user_id,
            )

            return links

        if span_id:
            link = await self.tracing_dao.delete_span(
                project_id=project_id,
                span_id=span_id,
                user_id=user_id,
            )

            return [link] if link else None

        if span_ids:
            links = await self.tracing_dao.delete_spans(
                project_id=project_id,
                span_ids=span_ids,
                user_id=user_id,
            )

            return links

        return None

    ### RPC ON SPANS

    async def query(  # QUERY
        self,
        *,
        project_id: UUID,
        query: Query,
    ) -> Optional[OTelFlatSpans]:
        parse_query(query)

        span_dtos = await self.tracing_dao.query(
            project_id=project_id,
            query=query,
        )

        return span_dtos
