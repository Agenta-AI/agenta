from typing import List, Optional
from uuid import UUID


from oss.src.utils.logging import get_module_logger

from oss.src.core.tracing.interfaces import TracingDAOInterface
from oss.src.core.tracing.dtos import OTelLink, OTelFlatSpan, Query, Bucket
from oss.src.core.tracing.utils import parse_query, parse_ingest


log = get_module_logger(__name__)


class TracingService:
    def __init__(
        self,
        tracing_dao: TracingDAOInterface,
    ):
        self.tracing_dao = tracing_dao

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
